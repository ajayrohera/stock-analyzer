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

async function getAllSymbols(): Promise<{ displayName: string, tradingSymbol: string }[]> {
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
            range: 'stocks!A2:B',
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];
        return rows
            .map(row => ({ displayName: row[0], tradingSymbol: row[1] }))
            .filter(s => s.displayName && s.tradingSymbol);
    } catch (error) {
        console.error('❌ Error fetching symbols from Google Sheets:', error);
        return [];
    }
}

async function updateVolumeHistory() {
    console.log('--- Starting Daily Data Update Cron Job (Final Performance Version) ---');

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
        console.log(`📊 Found ${symbols.length} symbols to update.`);
        
        // Load existing history from Redis to build upon it
        const existingHistoryStr = await redisClient.get('volume_history');
        const history: Record<string, any[]> = existingHistoryStr ? JSON.parse(existingHistoryStr) : {};
        console.log(`📚 Loaded existing history for ${Object.keys(history).length} symbols.`);
        
        // Fetch closing prices and volumes for all stocks in ONE batch call
        console.log('📡 Batch fetching all stock quotes...');
        const stockIdentifiers = symbols.map(s => {
          const exchange = (s.displayName === 'NIFTY' || s.displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
          return `${exchange}:${s.tradingSymbol}`;
        });
        const allStockQuotes = await kc.getQuote(stockIdentifiers);
        console.log('✅ Received all stock quotes.');

        const today = new Date().toISOString().split('T')[0];
        
        // Update history in memory
        for (const symbol of symbols) {
          const key = symbol.displayName.toUpperCase();
          const exchange = (symbol.displayName === 'NIFTY' || symbol.displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
          const data = allStockQuotes[`${exchange}:${symbol.tradingSymbol}`];
          
          if (!history[key]) {
            history[key] = [];
          }

          history[key] = history[key].filter((entry: any) => entry.date !== today);

          if (data && data.volume !== undefined && data.last_price !== undefined) {
            history[key].push({
              date: today,
              totalVolume: data.volume,
              lastPrice: data.last_price,
              timestamp: Date.now(),
            });
            history[key] = history[key].slice(-30);
          }
        }

        // Now, efficiently get all options data
        const dailySentimentData: Record<string, { oiPcr: number, volumePcr: number }> = {};
        const allInstruments = await kc.getInstruments('NFO');
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

        if (masterTokenList.length > 0) {
            console.log(`📡 Fetching all ${masterTokenList.length} option quotes in one batch...`);
            const allOptionQuotes = await kc.getQuote(masterTokenList);
            console.log('✅ All option quotes received.');

            for (const symbol of symbols) {
                const key = symbol.displayName.toUpperCase();
                const optionsChain = symbolToOptionsMap[key];
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
                    dailySentimentData[key] = {
                        oiPcr: totalCallOI > 0 ? totalPutOI / totalCallOI : 0,
                        volumePcr: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0,
                    };
                }
            }
        }

        console.log('💾 Saving all processed data to Redis...');
        await redisClient.setEx('volume_history', 90 * 24 * 60 * 60, JSON.stringify(history));
        await redisClient.setEx('daily_sentiment_data', 7 * 24 * 60 * 60, JSON.stringify(dailySentimentData));
        console.log('✅ All data saved successfully.');
        
    } catch (error) {
        console.error('❌ CRITICAL ERROR in daily update process:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    } finally {
        if (redisClient.isOpen) {
            await redisClient.quit();
            console.log('🔌 Disconnected from Redis.');
        }
    }
}

export { updateVolumeHistory };
