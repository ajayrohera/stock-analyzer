// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const BATCH_SIZE = 10; // Process 10 stocks per run
const PROCESSED_SET_KEY = 'cron:processed_stocks_today';
const HISTORY_KEY = 'volume_history';
const SENTIMENT_KEY = 'daily_sentiment_data';

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
    console.log(`--- Starting Cron Batch Run (Batch Size: ${BATCH_SIZE}) ---`);

    const redisClient = createClient({ url: process.env.REDIS_URL });
    try {
        await redisClient.connect();

        const symbols = await getAllSymbols();
        if (symbols.length === 0) {
            console.log("No symbols found. Exiting.");
            return;
        }

        const processedSymbols = await redisClient.sMembers(PROCESSED_SET_KEY);
        
        if (processedSymbols.length >= symbols.length) {
            console.log("✅ All symbols processed for today. Exiting.");
            // Optional: Check if it's a new day to reset the processed set
            const nowInIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            if (nowInIST.getHours() < 15) { // If it's before 3 PM, reset for the new day
                 await redisClient.del(PROCESSED_SET_KEY);
                 console.log("New day detected. Resetting processed symbols list.");
            }
            return;
        }

        const symbolsToProcess = symbols
            .filter(s => !processedSymbols.includes(s.displayName.toUpperCase()))
            .slice(0, BATCH_SIZE);

        if (symbolsToProcess.length === 0) {
            console.log("No new symbols to process in this run. Exiting.");
            return;
        }
        
        console.log(`📊 Processing batch of ${symbolsToProcess.length} symbols: [${symbolsToProcess.map(s => s.displayName).join(', ')}]`);

        const apiKey = process.env.KITE_API_KEY;
        if (!apiKey) throw new Error('KITE_API_KEY is not set.');
        const tokenDataString = await redisClient.get('kite_token');
        if (!tokenDataString) throw new Error('No Kite token in Redis.');
        const tokenData = JSON.parse(tokenDataString);
        if (!tokenData.accessToken) throw new Error('Invalid token data in Redis.');

        const kc = new KiteConnect({ api_key: apiKey });
        kc.setAccessToken(tokenData.accessToken);

        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - 45);

        const historyStr = await redisClient.get(HISTORY_KEY);
        const history = historyStr ? JSON.parse(historyStr) : {};
        
        const sentimentStr = await redisClient.get(SENTIMENT_KEY);
        const sentimentData = sentimentStr ? JSON.parse(sentimentStr) : {};

        const allInstruments = await kc.getInstruments('NFO');

        for (const symbol of symbolsToProcess) {
            try {
                // 1. Fetch and update historical data
                const records = await kc.getHistoricalData(symbol.instrumentToken, 'day', fromDate, toDate);
                const key = symbol.displayName.toUpperCase();
                history[key] = records.map((r: any) => ({
                    date: new Date(r.date).toISOString().split('T')[0],
                    totalVolume: r.volume,
                    lastPrice: r.close,
                    timestamp: new Date(r.date).getTime(),
                }));

                // 2. Fetch and update options data
                const unfilteredOptionsChain = allInstruments.filter((i: any) => i.name === symbol.tradingSymbol.toUpperCase());
                 if (unfilteredOptionsChain.length > 0) {
                    const todayDt = new Date();
                    todayDt.setHours(0, 0, 0, 0);
                    let nearestExpiry = new Date('2999-12-31');
                    unfilteredOptionsChain.forEach((opt: any) => {
                        const expiryDate = new Date(opt.expiry);
                        if (expiryDate >= todayDt && expiryDate < nearestExpiry) nearestExpiry = expiryDate;
                    });
                    const optionsChain = unfilteredOptionsChain.filter((i: any) => new Date(i.expiry).getTime() === nearestExpiry.getTime());
                    
                    if (optionsChain.length > 0) {
                        const instrumentTokens = optionsChain.map((o: any) => `NFO:${o.tradingsymbol}`);
                        const optionQuoteData = await kc.getQuote(instrumentTokens);
                        let totalCallOI = 0, totalPutOI = 0, totalCallVolume = 0, totalPutVolume = 0;
                        for (const token of instrumentTokens) {
                            const quote = optionQuoteData[token];
                            const instrument = optionsChain.find((o: any) => `NFO:${o.tradingsymbol}` === token);
                            if (quote && instrument) {
                                if (instrument.instrument_type === 'CE') {
                                    totalCallOI += quote.oi || 0;
                                    totalCallVolume += quote.volume || 0;
                                } else {
                                    totalPutOI += quote.oi || 0;
                                    totalPutVolume += quote.volume || 0;
                                }
                            }
                        }
                        sentimentData[key] = {
                            oiPcr: totalCallOI > 0 ? totalPutOI / totalCallOI : 0,
                            volumePcr: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0,
                        };
                    }
                }
                
                await redisClient.sAdd(PROCESSED_SET_KEY, key);
                console.log(`  ✅ Processed and marked ${symbol.displayName} as complete.`);

            } catch (error) {
                console.error(`  ❌ Failed to process ${symbol.displayName}:`, error instanceof Error ? error.message : 'Unknown error');
            }
        }

        // Save the updated data back to Redis
        await redisClient.set(HISTORY_KEY, JSON.stringify(history));
        await redisClient.set(SENTIMENT_KEY, JSON.stringify(sentimentData));

        // Set an expiry on the "processed" set so it automatically resets for the next day
        await redisClient.expire(PROCESSED_SET_KEY, 24 * 60 * 60);

        console.log(`✅ Batch complete. Total processed today: ${processedSymbols.length + symbolsToProcess.length} / ${symbols.length}`);

    } catch (error) {
        console.error('❌ CRITICAL ERROR in cron batch process:', error);
        throw error;
    } finally {
        if (redisClient.isOpen) {
            await redisClient.quit();
        }
    }
}

export { updateVolumeHistory };
