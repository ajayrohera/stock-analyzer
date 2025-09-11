import { NextRequest, NextResponse } from 'next/server';
import { KiteConnect } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

const tokenPath = path.join(process.cwd(), 'kite_token.json');
const volumeHistoryPath = path.join(process.cwd(), 'volume_history.json');

// Helper function to safely parse JSON
async function safeReadJson(filePath: string) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function getAllSymbols() {
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
    console.error('Error fetching symbols from sheet:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  // Simple authentication check
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) {
      throw new Error('KITE_API_KEY not set');
    }
    
    // Get all symbols to track
    const symbols = await getAllSymbols();
    if (symbols.length === 0) {
      return NextResponse.json({ error: 'No symbols found' }, { status: 400 });
    }
    
    console.log(`Updating volume for ${symbols.length} symbols:`, symbols);
    
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
        // Proper error handling with unknown type
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`Failed to update ${symbol}:`, errorMessage);
      }
    }
    
    // Save updated history
    await fs.writeFile(volumeHistoryPath, JSON.stringify(history, null, 2));
    
    return NextResponse.json({ 
      success: true, 
      updated: updatedCount,
      total: symbols.length,
      message: `Updated volume history for ${updatedCount}/${symbols.length} symbols`
    });

  } catch (error) {
    // Proper error handling for the main try-catch
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Volume update failed:', errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}