// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const isMarketClosedForDay = (): boolean => {
    const nowInIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const day = nowInIST.getDay();
    const hours = nowInIST.getHours();
    const minutes = nowInIST.getMinutes();
    if (day === 0 || day === 6) return true;
    if (hours > 15 || (hours === 15 && minutes >= 45)) return true;
    return false;
};

async function getAllSymbols(): Promise<{ displayName: string, tradingSymbol: string, instrumentToken: string }[]> {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                type: 'service_account',
                project_id: process.env.GOOGLE_PROJECT_ID,
                private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
                private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                client_id: process.env.GOOGLE_CLIENT_ID,
            },
            scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly'
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'stocks!A2:C',
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];
        return rows
            .map(row => ({ displayName: row[0], tradingSymbol: row[1], instrumentToken: row[2] }))
            .filter(s => s.displayName && s.tradingSymbol && s.instrumentToken);
    } catch (error) {
        console.error('❌ Error fetching symbols from Google Sheets:', error);
        return [];
    }
}

async function updateVolumeHistory() {
    console.log('--- Starting Daily Data Rebuild Cron Job (ULTRA Performance Version) ---');

    if (!isMarketClosedForDay()) {
        console.log('Market is not yet closed. Aborting cron job.');
        return;
    }

    const redisClient = createClient({ url: process.env.REDIS_URL });
    try {
        await redisClient.connect();
        console.log('✅ Connected to Redis');

        const apiKey = process.env.KITE_API_KEY;
        if (!apiKey) throw new Error('KITE_API_KEY is not set.');
        const tokenDataString = await redisClient.get('kite_token');
        if (!tokenDataString) throw new Error('No Kite token in Redis.');
        const tokenData = JSON.parse(tokenDataString);
        if (!tokenData.accessToken) throw new Error('Invalid token data in Redis.');

        const kc = new KiteConnect({ api_key: apiKey });
        kc.setAccessToken(tokenData.accessToken);
        console.log('🔑 KiteConnect initialized.');

        const symbols = await getAllSymbols();
        if (symbols.length === 0) throw new Error('No symbols found.');
        console.log(`📊 Found ${symbols.length} symbols to rebuild.`);

        console.log('🔥 Deleting old volume_history key to ensure clean slate...');
        await redisClient.del('volume_history');
        console.log('✅ Old history deleted.');
        
        const newHistory: Record<string, any[]> = {};
        const dailySentimentData: Record<string, { oiPcr: number, volumePcr: number }> = {};
        
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - 45);

        // === PERFORMANCE UPGRADE 1: Fetch all instruments ONCE ===
        console.log('📡 Fetching all NFO instruments...');
        const allInstruments = await kc.getInstruments('NFO');
        console.log(`✅ Received ${allInstruments.length} total instruments.`);

        // === PERFORMANCE UPGRADE 2: Build a master list of all option tokens needed ===
        console.log('🛠️ Building master list of required option tokens...');
        const masterTokenList: string[] = [];
        const symbolToOptionsMap: Record<string, any[]> = {};

        for (const symbol of symbols) {
            const unfilteredOptionsChain = allInstruments.filter((i: any) => i.name === symbol.tradingSymbol.toUpperCase() && (i.instrument_type === 'CE' || i.instrument_type === 'PE'));
            if (unfilteredOptionsChain.length > 0) {
                const todayDt = new Date();
                todayDt.setHours(0, 0, 0, 0);
                let nearestExpiry = new Date('2999-12-31');
                unfilteredOptionsChain.forEach((opt: any) => {
                    const expiryDate = new Date(opt.expiry);
                    if (expiryDate >= todayDt && expiryDate < nearestExpiry) nearestExpiry = expiryDate;
                });
                const optionsChain = unfilteredOptionsChain.filter((i: any) => new Date(i.expiry).getTime() === nearestExpiry.getTime());
                symbolToOptionsMap[symbol.displayName.toUpperCase()] = optionsChain;
                optionsChain.forEach((o: any) => masterTokenList.push(`NFO:${o.tradingsymbol}`));
            }
        }
        console.log(`✅ Master list built with ${masterTokenList.length} unique option tokens.`);

        // === PERFORMANCE UPGRADE 3: Make ONE massive API call for all options data ===
        console.log('📡 Fetching all option quotes in a single batch...');
        const allOptionQuotes = await kc.getQuote(masterTokenList);
        console.log('✅ Received all option quotes.');

        // Now, loop through and process everything from memory
        for (const symbol of symbols) {
            try {
                // 1. Rebuild Historical Data
                const records = await kc.getHistoricalData(symbol.instrumentToken, 'day', fromDate, toDate);
                newHistory[symbol.displayName.toUpperCase()] = records.map((r: any) => ({
                    date: new Date(r.date).toISOString().split('T')[0],
                    totalVolume: r.volume,
                    lastPrice: r.close,
                    timestamp: new Date(r.date).getTime(),
                }));

                // 2. Calculate EOD Sentiment Data from pre-fetched quotes
                const optionsChain = symbolToOptionsMap[symbol.displayName.toUpperCase()];
                if (optionsChain && optionsChain.length > 0) {
                    let totalCallOI = 0, totalPutOI = 0, totalCallVolume = 0, totalPutVolume = 0;
                    for (const instrument of optionsChain) {
                        const quote = allOptionQuotes[`NFO:${instrument.tradingsymbol}`];
                        if (quote) {
                            if (instrument.instrument_type === 'CE') {
                                totalCallOI += quote.oi || 0;
                                totalCallVolume += quote.volume || 0;
                            } else {
                                totalPutOI += quote.oi || 0;
                                totalPutVolume += quote.volume || 0;
                            }
                        }
                    }
                    dailySentimentData[symbol.displayName.toUpperCase()] = {
                        oiPcr: totalCallOI > 0 ? totalPutOI / totalCallOI : 0,
                        volumePcr: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0,
                    };
                }
            } catch (error) {
                console.error(`  ❌ Failed to process ${symbol.displayName}:`, error instanceof Error ? error.message : 'Unknown error');
            }
        }

        console.log('💾 Saving all rebuilt data to Redis...');
        await redisClient.setEx('volume_history', 90 * 24 * 60 * 60, JSON.stringify(newHistory));
        await redisClient.setEx('daily_sentiment_data', 7 * 24 * 60 * 60, JSON.stringify(dailySentimentData));
        console.log('✅ All data saved successfully.');
        
    } catch (error) {
        console.error('❌ CRITICAL ERROR in daily rebuild process:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    } finally {
        if (redisClient.isOpen) {
            await redisClient.quit();
            console.log('🔌 Disconnected from Redis.');
        }
    }
}

export { updateVolumeHistory };
