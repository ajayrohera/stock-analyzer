// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the root .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Helper function to get all symbols from Google Sheets
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
      range: 'stocks!A2:B', // Fetching both columns now
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];
    
    return rows
      .map(row => ({ displayName: row[0], tradingSymbol: row[1] }))
      .filter(s => s.displayName && s.tradingSymbol);

  } catch (error) {
    console.error('❌ Error fetching symbols from Google Sheets:', error);
    // Fallback to a default list in case of error
    return [{ displayName: 'NIFTY', tradingSymbol: 'NIFTY 50' }];
  }
}


// --- MAIN FUNCTION ---
async function updateVolumeHistory() {
  console.log('--- Starting Volume History Update ---');
  
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    // 1. Connect to Redis
    await redisClient.connect();
    console.log('✅ Connected to Redis');

    // 2. Get API Key and Access Token
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY is not set in environment variables.');

    const tokenDataString = await redisClient.get('kite_token');
    if (!tokenDataString) {
      throw new Error('No Kite token found in Redis. Please run the daily manual login script first.');
    }
    const tokenData = JSON.parse(tokenDataString);
    if (!tokenData.accessToken) {
      throw new Error('Invalid token data found in Redis: accessToken is missing.');
    }

    // 3. Initialize KiteConnect
    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);
    console.log('🔑 KiteConnect initialized with access token.');

    // 4. Get all symbols to track
    const symbols = await getAllSymbols();
    if (symbols.length === 0) throw new Error('No symbols found in Google Sheet.');
    console.log(`📊 Found ${symbols.length} symbols to update.`);

    // 5. Fetch existing history from Redis
    const existingHistoryStr = await redisClient.get('volume_history');
    const history: Record<string, any[]> = existingHistoryStr ? JSON.parse(existingHistoryStr) : {};

    // 6. Fetch latest data for all symbols
    const today = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    let updatedCount = 0;
    let failedCount = 0;

    const instrumentIdentifiers = symbols.map(s => {
      const exchange = (s.displayName === 'NIFTY' || s.displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
      return `${exchange}:${s.tradingSymbol}`;
    });

    const quoteData = await kc.getQuote(instrumentIdentifiers);

    for (const symbol of symbols) {
      try {
        const exchange = (symbol.displayName === 'NIFTY' || symbol.displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
        const data = quoteData[`${exchange}:${symbol.tradingSymbol}`];

        if (data && data.volume !== undefined && data.last_price !== undefined) {
          const newEntry = {
            date: today,
            totalVolume: data.volume,
            lastPrice: data.last_price,
            timestamp: timestamp,
          };

          if (!history[symbol.displayName]) {
            history[symbol.displayName] = [];
          }

          // Remove old entry for today to ensure data is fresh
          history[symbol.displayName] = history[symbol.displayName].filter(entry => entry.date !== today);
          history[symbol.displayName].push(newEntry);

          // Keep only last 30 entries (approx. 1.5 months of trading days)
          history[symbol.displayName] = history[symbol.displayName].slice(-30);
          
          updatedCount++;
          console.log(`  ✅ Updated ${symbol.displayName}`);
        } else {
          console.warn(`  ⚠️ No volume or price data for ${symbol.displayName}`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to process ${symbol.displayName}:`, error instanceof Error ? error.message : 'Unknown error');
        failedCount++;
      }
    }
    
    // 7. Save updated history back to Redis
    // Set expiry for 90 days, well beyond the 30 entries we store
    await redisClient.setEx('volume_history', 90 * 24 * 60 * 60, JSON.stringify(history));
    
    console.log(`\n📈 Successfully updated volume history for ${updatedCount}/${symbols.length} symbols.`);
    if (failedCount > 0) {
      console.log(`❌ Failed to update ${failedCount} symbols.`);
    }
    
  } catch (error) {
    console.error('❌ CRITICAL ERROR in volume update process:', error instanceof Error ? error.message : 'Unknown error');
    // Re-throw the error so the calling API route knows it failed
    throw error;
  } finally {
    // 8. Cleanup Redis connection
    if (redisClient.isOpen) {
      await redisClient.quit();
      console.log('🔌 Disconnected from Redis.');
    }
  }
}

export { updateVolumeHistory };