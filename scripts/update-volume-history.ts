// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

console.log('🔍 DEBUG: Script started');

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const tokenPath = path.join(process.cwd(), 'kite_token.json');
const volumeHistoryPath = path.join(process.cwd(), 'volume_history.json');

// Helper function to safely parse JSON
async function safeReadJson(filePath: string): Promise<any> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.log(`❌ Failed to read ${filePath}:`, error);
    return {};
  }
}

async function getAllSymbols(): Promise<string[]> {
  return ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'TATASTEEL, INFY'];
}

async function updateVolumeHistory() {
  try {
    console.log('🔍 DEBUG: Starting volume history update');
    
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY not set');
    
    const tokenData = await safeReadJson(tokenPath);
    if (!tokenData.accessToken) {
      throw new Error('No access token found. Please run authenticate.ts first');
    }
    
    if (!tokenData.refreshToken) {
      console.log('⚠️  WARNING: No refresh token found - token cannot be auto-refreshed');
    }
    
    const symbols = await getAllSymbols();
    console.log('📊 Updating volume data for:', symbols.join(', '));
    
    // Initialize KiteConnect
    const kc = new KiteConnect({
      api_key: apiKey
    }) as any;
    
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
        const instrumentId = `${exchange}:${tradingsymbol}`;
        
        let quote;
        try {
          quote = await kc.getQuote([instrumentId]);
        } catch (error: any) {
          console.error(`❌ Failed to get quote for ${symbol}:`, error.message);
          failedCount++;
          continue;
        }
        
        const data = quote[instrumentId];
        
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
    console.error('❌ Error in updateVolumeHistory:', error);
  }
}

// Simple execution
console.log('🚀 Starting update process');
updateVolumeHistory();