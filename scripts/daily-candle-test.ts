import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { google } from 'googleapis';

// This script runs daily at 9:31 AM IST to calculate 3-candle test for all symbols

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL! });
  await client.connect();
  return client;
}

async function getAllSymbolsWithMapping(): Promise<Map<string, string>> {
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
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: 'stocks!A2:B'
  });
  
  const symbolMap = new Map<string, string>();
  
  response.data.values?.forEach(row => {
    if (row[0] && row[1]) {
      symbolMap.set(row[0], row[1]);
    }
  });
  
  console.log(`📊 Loaded ${symbolMap.size} symbol mappings`);
  return symbolMap;
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

function calculateThreeCandleSentiment(candle1: Candle, candle2: Candle, candle3: Candle): {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  strength: 'very_bullish' | 'bullish' | 'neutral' | 'bearish' | 'very_bearish';
  description: string;
} {
  const close1 = candle1.close;
  const close2 = candle2.close;
  const close3 = candle3.close;
  
  const aboveBoth = close3 > close1 && close3 > close2;
  const belowBoth = close3 < close1 && close3 < close2;
  
  if (!aboveBoth && !belowBoth) {
    return {
      sentiment: 'neutral',
      strength: 'neutral',
      description: '3rd candle closed between first two candles'
    };
  }
  
  const percentAbove1 = ((close3 - close1) / close1) * 100;
  const percentAbove2 = ((close3 - close2) / close2) * 100;
  const minPercentGain = Math.min(percentAbove1, percentAbove2);
  const maxPercentLoss = Math.max(percentAbove1, percentAbove2);
  
  if (aboveBoth) {
    if (minPercentGain > 0.10) {
      return {
        sentiment: 'bullish',
        strength: 'very_bullish',
        description: '3rd candle closed >0.10% above both first two candles'
      };
    } else if (minPercentGain > 0.05) {
      return {
        sentiment: 'bullish',
        strength: 'bullish', 
        description: '3rd candle closed >0.05% above both first two candles'
      };
    } else {
      return {
        sentiment: 'bullish',
        strength: 'bullish',
        description: '3rd candle closed above both first two candles'
      };
    }
  } else {
    if (maxPercentLoss < -0.10) {
      return {
        sentiment: 'bearish',
        strength: 'very_bearish',
        description: '3rd candle closed >0.10% below both first two candles'
      };
    } else if (maxPercentLoss < -0.05) {
      return {
        sentiment: 'bearish',
        strength: 'bearish',
        description: '3rd candle closed >0.05% below both first two candles'
      };
    } else {
      return {
        sentiment: 'bearish',
        strength: 'bearish',
        description: '3rd candle closed below both first two candles'
      };
    }
  }
}

async function simulateThreeCandleTest(kite: any, instrumentToken: string, symbol: string) {
  try {
    const quoteData = await kite.getQuote([instrumentToken]);
    const instrumentData = quoteData[instrumentToken];
    
    if (!instrumentData || !instrumentData.ohlc) {
      console.log(`⚠️ No OHLC data available for ${symbol}`);
      return null;
    }
    
    const marketOpenPrice = instrumentData.ohlc.open;
    const currentPrice = instrumentData.last_price;
    
    const priceChange = ((currentPrice - marketOpenPrice) / marketOpenPrice) * 100;
    
    let analysis;
    if (priceChange > 0.05) {
      analysis = {
        sentiment: 'bullish' as const,
        strength: 'bullish' as const,
        description: `Price up ${priceChange.toFixed(2)}% since market open`
      };
    } else if (priceChange < -0.05) {
      analysis = {
        sentiment: 'bearish' as const,
        strength: 'bearish' as const,
        description: `Price down ${Math.abs(priceChange).toFixed(2)}% since market open`
      };
    } else {
      analysis = {
        sentiment: 'neutral' as const,
        strength: 'neutral' as const,
        description: 'Price relatively unchanged since market open'
      };
    }
    
    return {
      ...analysis,
      prices: {
        market_open: marketOpenPrice,
        current_price: currentPrice,
        change_percent: priceChange
      },
      calculatedAt: new Date().toISOString(),
    };
    
  } catch (error) {
    console.error(`Error simulating 3-candle test for ${symbol}:`, error);
    return null;
  }
}

export async function calculateDailyCandleTest() {
  console.log('🕯️ Starting daily 3-candle test calculation...');
  
  const redis = await getRedisClient();
  
  try {
    const kite = new KiteConnect({
      api_key: process.env.KITE_API_KEY!
    });
    
    const tokenData = await redis.get('kite_token');
    if (!tokenData) {
      throw new Error('Kite token not found');
    }
    kite.setAccessToken(JSON.parse(tokenData).accessToken);
    
    // === FIX: Load symbol mapping ONCE ===
    console.log('📊 Loading symbol mappings from Google Sheets...');
    const symbolMap = await getAllSymbolsWithMapping();
    const symbols = Array.from(symbolMap.keys());
    console.log(`📊 Analyzing ${symbols.length} symbols`);
    
    const results: any = {};
    
    // Batch processing
    const batchSize = 30;
    const totalBatches = Math.ceil(symbols.length / batchSize);
    
    console.log(`🔄 Processing in ${totalBatches} batches of ${batchSize} symbols each`);
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const start = batch * batchSize;
      const end = start + batchSize;
      const batchSymbols = symbols.slice(start, end);
      
      console.log(`\n📦 Processing batch ${batch + 1}/${totalBatches}: ${batchSymbols.length} symbols`);
      
      const batchResults: any = {};
      
      for (const symbol of batchSymbols) {
        try {
          // === FIX: Use cached mapping instead of API call ===
          const tradingSymbol = symbolMap.get(symbol);
          if (!tradingSymbol) {
            console.log(`⚠️ No mapping found for symbol: ${symbol}`);
            continue;
          }
          
          const exchange = (symbol === 'NIFTY' || symbol === 'BANKNIFTY') ? 'NFO' : 'NSE';
          const instrumentToken = `${exchange}:${tradingSymbol}`;
          
          console.log(`📈 Processing ${symbol} (${instrumentToken})`);
          
          const analysis = await simulateThreeCandleTest(kite, instrumentToken, symbol);
          
          if (analysis) {
            batchResults[symbol] = analysis;
            console.log(`✅ ${symbol}: ${analysis.strength} (${analysis.sentiment})`);
          } else {
            console.log(`⚠️ Could not analyze ${symbol}`);
          }
          
          // Reduced delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`❌ Error processing ${symbol}:`, error);
          // Continue with next symbol even if one fails
        }
      }
      
      // Merge batch results into main results
      Object.assign(results, batchResults);
      
      // Save progress after each batch
      await redis.set('daily_candle_test', JSON.stringify(results));
      console.log(`💾 Saved batch ${batch + 1} progress. Total processed: ${Object.keys(results).length} symbols`);
      
      // Longer delay between batches to avoid quota issues
      if (batch < totalBatches - 1) {
        console.log(`⏳ Waiting 5 seconds before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    console.log(`\n✅ Daily 3-candle test completed. Processed ${Object.keys(results).length} symbols`);
    
    return results;
    
  } catch (error) {
    console.error('❌ Daily candle test failed:', error);
    throw error;
  } finally {
    await redis.quit();
  }
}

// API route handler for Vercel
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  
  try {
    console.log('🚀 Cron job triggered for daily candle test');
    const results = await calculateDailyCandleTest();
    res.status(200).json({ 
      success: true, 
      processed: Object.keys(results).length,
      batches: Math.ceil(results.length / 30),
      message: `Processed ${Object.keys(results).length} symbols successfully`
    });
  } catch (error) {
    console.error('Cron job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Run if called directly (for testing)
if (require.main === module) {
  calculateDailyCandleTest().catch(console.error);
}