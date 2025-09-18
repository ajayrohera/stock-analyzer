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
  console.log('--- Starting Volume History Update ---');
  
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    console.log('✅ Connected to Redis');

    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY is not set.');

    const tokenDataString = await redisClient.get('kite_token');
    if (!tokenDataString) {
      throw new Error('No Kite token in Redis. Please run daily login script.');
    }
    const tokenData = JSON.parse(tokenDataString);
    if (!tokenData.accessToken) {
      throw new Error('Invalid token data in Redis: accessToken is missing.');
    }

    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);
    console.log('🔑 KiteConnect initialized with access token.');

    const symbols = await getAllSymbols();
    if (symbols.length === 0) throw new Error('No symbols found in Google Sheet.');
    console.log(`📊 Found ${symbols.length} symbols to update.`);

    const existingHistoryStr = await redisClient.get('volume_history');
    const history: Record<string, any[]> = existingHistoryStr ? JSON.parse(existingHistoryStr) : {};

    const today = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    let updatedCount = 0;
    let failedCount = 0;

    const instrumentIdentifiers = symbols.map(s => {
      const exchange = (s.displayName === 'NIFTY' || s.displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
      return `${exchange}:${s.tradingSymbol}`;
    });

    // === FINAL FIX: Robust error handling around the main API call ===
    let quoteData;
    try {
      console.log(`📡 Fetching quotes for ${instrumentIdentifiers.length} instruments...`);
      quoteData = await kc.getQuote(instrumentIdentifiers);
      console.log('✅ Successfully received quote data from API.');
    } catch (apiError) {
      // This is the critical new catch block.
      console.error('❌ CRITICAL API FAILURE: The call to kc.getQuote() failed.');
      if (apiError instanceof Error) {
        console.error('   Error Message:', apiError.message);
        console.error('   Stack Trace:', apiError.stack);
      } else {
        console.error('   Raw Error:', apiError);
      }
      // Re-throw the error to ensure the cron job is marked as failed.
      throw new Error('Failed to fetch quote data from Kite API.');
    }
    // ===============================================================

    for (const symbol of symbols) {
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

        history[symbol.displayName] = history[symbol.displayName].filter(entry => entry.date !== today);
        history[symbol.displayName].push(newEntry);
        history[symbol.displayName] = history[symbol.displayName].slice(-30);
        
        updatedCount++;
      } else {
        console.warn(`  ⚠️ No data returned for ${symbol.displayName}. It may be an invalid or expired symbol.`);
        failedCount++;
      }
    }
    
    await redisClient.setEx('volume_history', 90 * 24 * 60 * 60, JSON.stringify(history));
    
    console.log(`\n📈 Successfully processed ${updatedCount}/${symbols.length} symbols.`);
    if (failedCount > 0) {
      console.log(`❌ Failed to find data for ${failedCount} symbols.`);
    }
    
  } catch (error) {
    console.error('❌ FATAL ERROR in volume update process:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
      console.log('🔌 Disconnected from Redis.');
    }
  }
}

export { updateVolumeHistory };