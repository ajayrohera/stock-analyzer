// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the root .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Add market status function
const getMarketStatus = (): 'OPEN' | 'CLOSED' => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const day = istTime.getDay();
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    if (day > 0 && day < 6) {
        if (hours > 9 || (hours === 9 && minutes >= 15)) {
            if (hours < 15 || (hours === 15 && minutes <= 30)) {
                return 'OPEN';
            }
        }
    }
    return 'CLOSED';
};

// Helper function to get all symbols from Google Sheets
async function getAllSymbols(): Promise<{ displayName: string, tradingSymbol: string }[]> {
  try {
    console.log('🔍 Fetching symbols from Google Sheets...');
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
    if (!rows || rows.length === 0) {
      console.log('⚠️ No rows found in Google Sheets');
      return [];
    }
    
    const symbols = rows
      .map(row => ({ displayName: row[0], tradingSymbol: row[1] }))
      .filter(s => s.displayName && s.tradingSymbol);

    console.log(`✅ Found ${symbols.length} symbols in Google Sheets`);
    return symbols;

  } catch (error) {
    console.error('❌ Error fetching symbols from Google Sheets:', error);
    // Fallback to a default list in case of error
    return [{ displayName: 'NIFTY', tradingSymbol: 'NIFTY 50' }];
  }
}

// --- MAIN FUNCTION ---
async function updateVolumeHistory() {
  console.log('🔄 --- Starting Volume History Update ---');
  
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    // 1. Connect to Redis
    console.log('🔌 Attempting to connect to Redis...');
    await redisClient.connect();
    console.log('✅ Connected to Redis');
    console.log('🔍 REDIS CONNECTION DEBUG - isOpen:', redisClient.isOpen);
    console.log('🔍 REDIS URL:', process.env.REDIS_URL ? 'Set' : 'Not set');

    // 2. Get API Key and Access Token
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY is not set in environment variables.');

    const tokenDataString = await redisClient.get('kite_token');
    console.log('🔍 Kite token exists:', !!tokenDataString);
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
    console.log(`📊 Found ${symbols.length} symbols to update:`, symbols.map(s => s.displayName));

    // 5. Fetch existing history from Redis
    const existingHistoryStr = await redisClient.get('volume_history');
    console.log('📦 EXISTING HISTORY DEBUG - raw data:', existingHistoryStr ? existingHistoryStr.substring(0, 100) + '...' : 'NULL');
    
    const history: Record<string, any[]> = existingHistoryStr ? JSON.parse(existingHistoryStr) : {};
    console.log(`📊 Existing history contains ${Object.keys(history).length} symbols`);

    // 6. Fetch latest data for all symbols
    const today = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    let updatedCount = 0;
    let skippedCount = 0;

    const instrumentIdentifiers = symbols.map(s => {
      const exchange = (s.displayName === 'NIFTY' || s.displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
      return `${exchange}:${s.tradingSymbol}`;
    });

    console.log(`📡 Fetching quotes for ${instrumentIdentifiers.length} instruments...`);
    let quoteData;
    try {
      quoteData = await kc.getQuote(instrumentIdentifiers);
      console.log('✅ Successfully received quote data from API.');
    } catch (apiError) {
      console.error('❌ CRITICAL API FAILURE: The call to kc.getQuote() failed.');
      if (apiError instanceof Error) {
        console.error('   Error Message:', apiError.message);
      } else {
        console.error('   Raw Error:', apiError);
      }
      throw new Error('Failed to fetch quote data from Kite API.');
    }

    // 7. Check market status
    const marketStatus = getMarketStatus();
    console.log(`🏛️ Market status: ${marketStatus}`);

    for (const symbol of symbols) {
      try {
        const exchange = (symbol.displayName === 'NIFTY' || symbol.displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
        const data = quoteData[`${exchange}:${symbol.tradingSymbol}`];

        if (data && data.volume !== undefined && data.last_price !== undefined) {
          // UPDATED CRON JOB LOGIC: Only store data when market is CLOSED
          if (marketStatus === 'CLOSED' && data.volume > 0) {
            // --- FIX: previously only stored totalVolume + lastPrice,
            // never high/low. Since A/D Line needs to know where the
            // close sits WITHIN a day's high-low range, every stored day
            // was structurally forced to high===low===close, making the
            // multi-day A/D average always exactly zero — permanently,
            // no matter how much history accumulated. Kite's getQuote()
            // already returns real high/low via the `ohlc` object; it
            // was just never being saved. Falls back to last_price only
            // if ohlc is genuinely missing (shouldn't normally happen).
            const newEntry = {
              date: today,
              totalVolume: data.volume,
              lastPrice: data.last_price,
              high: data.ohlc?.high || data.last_price,
              low: data.ohlc?.low || data.last_price,
              close: data.ohlc?.close || data.last_price,
              timestamp: timestamp,
            };

            const key = symbol.displayName.toUpperCase();
            if (!history[key]) {
              history[key] = [];
            }

            // Remove old entry for today to ensure data is fresh
            history[key] = history[key].filter(entry => entry.date !== today);
            history[key].push(newEntry);

            // Keep only last 30 entries (approx. 1.5 months of trading days)
            history[key] = history[key].slice(-30);
            
            updatedCount++;
            console.log(`✅ Stored EOD data for ${symbol.displayName}: Volume=${data.volume}, Price=${data.last_price}`);
          } else {
            skippedCount++;
            console.log(`⏸️ Skipped ${symbol.displayName} (market status: ${marketStatus}, volume: ${data.volume})`);
          }
        } else {
          console.warn(`  ⚠️ No volume or price data for ${symbol.displayName}`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`  ❌ Failed to process ${symbol.displayName}:`, error instanceof Error ? error.message : 'Unknown error');
        skippedCount++;
      }
    }
    
    // 8. Save updated history back to Redis only if we have changes
    if (updatedCount > 0) {
      console.log(`💾 Saving updated history with ${Object.keys(history).length} symbols`);
      await redisClient.setEx('volume_history', 90 * 24 * 60 * 60, JSON.stringify(history));
    } else {
      console.log('💾 No updates to save (market open or no valid data)');
    }
    
    console.log(`📈 Volume update completed. Updated: ${updatedCount}, Skipped: ${skippedCount}/${symbols.length} symbols.`);
    
  } catch (error) {
    console.error('❌ CRITICAL ERROR in volume update process:', error instanceof Error ? error.message : 'Unknown error');
    // Re-throw the error so the calling API route knows it failed
    throw error;
  } finally {
    // 9. Cleanup Redis connection
    if (redisClient.isOpen) {
      await redisClient.quit();
      console.log('🔌 Disconnected from Redis.');
    }
  }
}

export { updateVolumeHistory };