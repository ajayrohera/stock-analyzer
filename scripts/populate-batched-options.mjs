// scripts/populate-batched-options.mjs
import { createClient } from 'redis';
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Get symbol from command line argument
const symbol = process.argv[2];
if (!symbol) {
  console.error('❌ Error: Symbol argument is required');
  console.log('Usage: node scripts/populate-batched-options.mjs <SYMBOL>');
  console.log('Example: node scripts/populate-batched-options.mjs LAURUSLABS');
  console.log('Example: node scripts/populate-batched-options.mjs RELIANCE');
  process.exit(1);
}

async function populateBatchedOptions(symbol) {
  const redis = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redis.connect();
    console.log('🔗 Connected to Redis');
    
    // Get kite token
    const tokenDataStr = await redis.get('kite_token');
    if (!tokenDataStr) {
      throw new Error('Kite token not found in Redis. Run login script first.');
    }
    
    const tokenData = JSON.parse(tokenDataStr);
    const kc = new KiteConnect({ api_key: process.env.KITE_API_KEY });
    kc.setAccessToken(tokenData.accessToken);
    
    console.log(`📡 Fetching current market data for ${symbol}...`);
    
    // Determine exchange based on symbol type
    const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'].includes(symbol.toUpperCase());
    const exchange = isIndex ? 'NSE' : 'NSE';
    const underlyingSymbol = isIndex ? symbol : symbol;
    
    // First, get the current price
    const underlyingQuote = await kc.getQuote([`${exchange}:${underlyingSymbol}`]);
    const currentPrice = underlyingQuote[`${exchange}:${underlyingSymbol}`]?.last_price;
    
    console.log(`💰 ${symbol} Current Price:`, currentPrice);
    
    if (!currentPrice) {
      throw new Error(`Could not fetch current price for ${symbol}`);
    }
    
    // Get ALL instruments to find options
    const allInstruments = await kc.getInstruments('NFO');
    
    // Filter for symbol options with nearby strikes (within 20% of current price)
    const symbolOptions = allInstruments.filter(instrument => 
      instrument.name === symbol.toUpperCase() && 
      (instrument.instrument_type === 'CE' || instrument.instrument_type === 'PE') &&
      Math.abs(instrument.strike - currentPrice) <= currentPrice * 0.2 // ±20% strikes only
    );
    
    console.log(`📊 Found ${symbolOptions.length} nearby strike options for ${symbol}`);
    
    if (symbolOptions.length === 0) {
      console.log('ℹ️  No options found. Checking if symbol might be different case...');
      
      // Try case-insensitive search
      const allSymbols = [...new Set(allInstruments.map(i => i.name))];
      const matchingSymbols = allSymbols.filter(s => 
        s.toLowerCase() === symbol.toLowerCase()
      );
      
      if (matchingSymbols.length > 0) {
        console.log(`ℹ️  Found possible matches: ${matchingSymbols.join(', ')}`);
        console.log(`ℹ️  Try using one of these symbols instead`);
      }
      
      throw new Error(`No options found for symbol: ${symbol}`);
    }
    
    // Batch the requests to avoid URI too long error
    const BATCH_SIZE = 100;
    const allQuotes = {};
    
    for (let i = 0; i < symbolOptions.length; i += BATCH_SIZE) {
      const batch = symbolOptions.slice(i, i + BATCH_SIZE);
      const batchTokens = batch.map(opt => `NFO:${opt.tradingsymbol}`);
      
      console.log(`📦 Fetching batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(symbolOptions.length/BATCH_SIZE)}`);
      
      try {
        const batchQuotes = await kc.getQuote(batchTokens);
        Object.assign(allQuotes, batchQuotes);
      } catch (error) {
        console.log(`⚠️  Skipping batch due to error:`, error.message);
      }
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Prepare data with live OI values
    const optionsWithData = symbolOptions.map(option => {
      const quote = allQuotes[`NFO:${option.tradingsymbol}`];
      return {
        ...option,
        oi: quote?.oi || 0,
        volume: quote?.volume || 0,
        last_price: quote?.last_price || 0,
        timestamp: new Date().toISOString()
      };
    });
    
    // Filter out options with zero OI (inactive)
    const activeOptions = optionsWithData.filter(opt => opt.oi > 0);
    
    console.log(`📈 Active options with OI: ${activeOptions.length}`);
    
    // Store in Redis with multiple access patterns
    const redisKey = `${symbol.toUpperCase()}:options`;
    
    // Store individual symbol data
    await redis.set(redisKey, JSON.stringify(activeOptions));
    
    // Also store in cache for bulk operations
    const existingCache = JSON.parse(await redis.get('options_cache') || '{}');
    existingCache[symbol.toUpperCase()] = activeOptions;
    await redis.set('options_cache', JSON.stringify(existingCache));
    
    console.log(`✅ Live options data for ${symbol} populated successfully`);
    console.log(`✅ Stored under key: ${redisKey}`);
    
    // Show sample data
    activeOptions.slice(0, 10).forEach(opt => {
      console.log(`   ${opt.tradingsymbol}: OI=${opt.oi}, Strike=${opt.strike}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await redis.disconnect();
    console.log('👋 Disconnected from Redis');
  }
}

populateBatchedOptions(symbol);