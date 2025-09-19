// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the root .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Helper to get all symbols from Google Sheets
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
    return [{ displayName: 'NIFTY', tradingSymbol: 'NIFTY 50' }];
  }
}

// --- MAIN FUNCTION ---
async function updateVolumeHistory() {
  console.log('--- Starting Daily Data Update Cron Job ---');
  
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    console.log('✅ Connected to Redis');

    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY is not set.');

    const tokenDataString = await redisClient.get('kite_token');
    if (!tokenDataString) throw new Error('No Kite token in Redis. Please run daily login script.');
    
    const tokenData = JSON.parse(tokenDataString);
    if (!tokenData.accessToken) throw new Error('Invalid token data in Redis: accessToken is missing.');

    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);
    console.log('🔑 KiteConnect initialized.');

    const symbols = await getAllSymbols();
    if (symbols.length === 0) throw new Error('No symbols found.');
    console.log(`📊 Found ${symbols.length} symbols to update.`);

    const existingHistoryStr = await redisClient.get('volume_history');
    const history: Record<string, any[]> = existingHistoryStr ? JSON.parse(existingHistoryStr) : {};
    
    const dailySentimentData: Record<string, { oiPcr: number, volumePcr: number }> = {};
    const allInstruments = await kc.getInstruments('NFO');

    for (const symbol of symbols) {
      try {
        console.log(`  -> Processing ${symbol.displayName}...`);
        const exchange = (symbol.displayName === 'NIFTY' || symbol.displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
        
        // 1. Update Volume History
        const quote = await kc.getQuote([`${exchange}:${symbol.tradingSymbol}`]);
        const data = quote[`${exchange}:${symbol.tradingSymbol}`];
        if (data && data.volume !== undefined && data.last_price !== undefined) {
          const key = symbol.displayName.toUpperCase();
          if (!history[key]) history[key] = [];
          history[key] = history[key].filter(entry => entry.date !== new Date().toISOString().split('T')[0]);
          history[key].push({
            date: new Date().toISOString().split('T')[0],
            totalVolume: data.volume,
            lastPrice: data.last_price,
            timestamp: Date.now(),
          });
          history[key] = history[key].slice(-30);
        }

        // 2. Calculate and Store Daily PCR Data
        const unfilteredOptionsChain = allInstruments.filter(i => i.name === symbol.tradingSymbol.toUpperCase() && (i.instrument_type === 'CE' || i.instrument_type === 'PE'));
        if (unfilteredOptionsChain.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          let nearestExpiry = new Date('2999-12-31');
          unfilteredOptionsChain.forEach(opt => {
            const expiryDate = new Date(opt.expiry);
            if (expiryDate >= today && expiryDate < nearestExpiry) nearestExpiry = expiryDate;
          });
          const optionsChain = unfilteredOptionsChain.filter(i => new Date(i.expiry).getTime() === nearestExpiry.getTime());
          
          const instrumentTokens = optionsChain.map(o => `NFO:${o.tradingsymbol}`);
          const optionQuoteData = await kc.getQuote(instrumentTokens);

          let totalCallOI = 0, totalPutOI = 0, totalCallVolume = 0, totalPutVolume = 0;
          for (const token of instrumentTokens) {
            const quote = optionQuoteData[token];
            const instrument = optionsChain.find(o => `NFO:${o.tradingsymbol}` === token);
            if (quote && instrument) {
              if (instrument.instrument_type === 'CE') {
                totalCallOI += quote.oi || 0;
                totalCallVolume += quote.volume || 0;
              } else if (instrument.instrument_type === 'PE') {
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
        console.log(`     ✅ Done.`);
      } catch (error) {
        console.error(`  ❌ Failed to process ${symbol.displayName}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    // Save both data sets back to Redis
    await redisClient.setEx('volume_history', 90 * 24 * 60 * 60, JSON.stringify(history));
    await redisClient.setEx('daily_sentiment_data', 7 * 24 * 60 * 60, JSON.stringify(dailySentimentData)); // Store for 7 days
    
    console.log(`\n📈 Successfully updated data for ${symbols.length} symbols.`);
    
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