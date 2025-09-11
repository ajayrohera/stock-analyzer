// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

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
    console.error('Error fetching symbols from sheet:', errorMessage);
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
    
    // Initialize KiteConnect
    const tokenData = await safeReadJson(tokenPath);
    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);
    
    // Load existing history
    let history: Record<string, Array<{date: string, totalVolume: number, timestamp: number}>> = await safeReadJson(volumeHistoryPath);
    
    // Fetch latest data for all symbols
    const today = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    let updatedCount = 0;

    for (const symbol of symbols) {
      try {
        // Determine exchange based on symbol type
        const exchange = (symbol === 'NIFTY' || symbol === 'BANKNIFTY') ? 'NFO' : 'NSE';
        const tradingsymbol = symbol;
        
        const quote = await kc.getQuote([`${exchange}:${tradingsymbol}`]);
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
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`Failed to update ${symbol}:`, errorMessage);
      }
    }
    
    // Save updated history
    await fs.writeFile(volumeHistoryPath, JSON.stringify(history, null, 2));
    console.log(`Successfully updated volume history for ${updatedCount}/${symbols.length} symbols`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Volume update failed:', errorMessage);
    process.exit(1);
  }
}

// Run the function if this script is executed directly
if (require.main === module) {
  updateVolumeHistory();
}

export { updateVolumeHistory };