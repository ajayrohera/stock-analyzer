// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const tokenPath = path.join(process.cwd(), 'kite_token.json');
const volumeHistoryPath = path.join(process.cwd(), 'volume_history.json');

// Helper function to safely parse JSON
async function safeReadJson(filePath: string): Promise<any> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

// Helper function to refresh token - using type assertion to avoid TypeScript errors
async function refreshAccessToken(kc: any, tokenData: any): Promise<any> {
  try {
    console.log('🔄 Token expired, attempting refresh...');
    
    if (!process.env.KITE_API_SECRET) {
      throw new Error('KITE_API_SECRET not set for token refresh');
    }

    // Use type assertion to access renewAccessToken method
    const refreshResponse = await kc.renewAccessToken(tokenData.refreshToken, process.env.KITE_API_SECRET!);
    
    const newTokenData = {
      accessToken: refreshResponse.access_token,
      refreshToken: refreshResponse.refresh_token,
      loginTime: Date.now()
    };
    
    await fs.writeFile(tokenPath, JSON.stringify(newTokenData, null, 2));
    console.log('✅ Token refreshed successfully');
    return newTokenData;
  } catch (error) {
    console.error('❌ Token refresh failed:', error);
    throw new Error('Token refresh failed. Please re-authenticate by running authenticate.ts');
  }
}

async function getAllSymbols(): Promise<string[]> {
  try {
    const auth = new google.auth.GoogleAuth({ 
      keyFile: path.join(process.cwd(), 'credentials.json'), 
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly' 
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1NeUJ-N3yNAhtLN0VPV71vY88MTTAYGEW8gGxtNbVcRU',
      range: 'stocks!A2:A',
    });
    
    return response.data.values?.flat().filter(Boolean) || [];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('❌ Error fetching symbols from sheet:', errorMessage);
    return [];
  }
}

async function updateVolumeHistory() {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY not set');
    
    // Get all symbols to track
    const symbols = await getAllSymbols();
    if (symbols.length === 0) throw new Error('No symbols found');
    
    console.log(`📊 Found ${symbols.length} symbols to update`);
    
    // Initialize KiteConnect
    const tokenData = await safeReadJson(tokenPath);
    if (!tokenData.accessToken) {
      throw new Error('No access token found. Please run authenticate.ts first');
    }
    
    // Initialize with type assertion to avoid TypeScript errors
    const kc = new KiteConnect({
      api_key: apiKey
    }) as any;
    
    // Set access token
    kc.setAccessToken(tokenData.accessToken);
    
    // Load existing history
    let history: Record<string, Array<{date: string, totalVolume: number, timestamp: number}>> = await safeReadJson(volumeHistoryPath);
    
    // Fetch latest data for all symbols
    const today = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    let updatedCount = 0;
    let failedCount = 0;

    for (const symbol of symbols) {
      try {
        // Determine exchange based on symbol type
        const exchange = (symbol === 'NIFTY' || symbol === 'BANKNIFTY') ? 'NFO' : 'NSE';
        const tradingsymbol = symbol;
        
        let quote;
        try {
          quote = await kc.getQuote([`${exchange}:${tradingsymbol}`]);
        } catch (error: any) {
          // If token expired, refresh and retry
          if (error.message.includes('token') || error.message.includes('expired') || error.message.includes('invalid') || error.message.includes('401')) {
            const newTokenData = await refreshAccessToken(kc, tokenData);
            kc.setAccessToken(newTokenData.accessToken);
            quote = await kc.getQuote([`${exchange}:${tradingsymbol}`]);
          } else {
            throw error;
          }
        }
        
        const data = quote[`${exchange}:${tradingsymbol}`];
        
        if (data && data.volume !== undefined) {
          if (!history[symbol]) history[symbol] = [];
          
          // Remove old entry for today if it exists
          history[symbol] = history[symbol].filter(entry => entry.date !== today);
          
          // Add new entry
          history[symbol].push({
            date: today,
            totalVolume: data.volume,
            timestamp: timestamp
          });
          
          // Keep only last 20 days
          const twentyDaysAgo = timestamp - (20 * 24 * 60 * 60 * 1000);
          history[symbol] = history[symbol].filter(entry => entry.timestamp > twentyDaysAgo);
          
          updatedCount++;
          process.stdout.write(`✅ ${symbol} `);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`\n❌ Failed to update ${symbol}:`, errorMessage);
        failedCount++;
      }
    }
    
    // Save updated history
    await fs.writeFile(volumeHistoryPath, JSON.stringify(history, null, 2));
    console.log(`\n\n📈 Successfully updated volume history for ${updatedCount}/${symbols.length} symbols`);
    if (failedCount > 0) {
      console.log(`❌ Failed to update ${failedCount} symbols`);
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('❌ Volume update failed:', errorMessage);
    
    // If it's a token error, we need manual reauthentication
    if (errorMessage.includes('token') || errorMessage.includes('expired') || errorMessage.includes('invalid')) {
      console.log('\n⚠️  Token needs manual refresh. Please run: npx ts-node scripts/authenticate.ts');
    }
    
    process.exit(1);
  }
}

// ES module way to check if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  updateVolumeHistory();
}

export { updateVolumeHistory };