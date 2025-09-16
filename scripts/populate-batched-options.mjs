// scripts/populate-batched-options.mjs
import { createClient } from 'redis';
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function populateBatchedOptions() {
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
    
    console.log('📡 Fetching current market data...');
    
    // First, get the current stock price
    const underlyingQuote = await kc.getQuote(['NSE:LAURUSLABS']);
    const currentPrice = underlyingQuote['NSE:LAURUSLABS']?.last_price;
    
    console.log('💰 LAURUSLABS Current Price:', currentPrice);
    
    if (!currentPrice) {
      throw new Error('Could not fetch current price for LAURUSLABS');
    }
    
    // Get ALL instruments to find options
    const allInstruments = await kc.getInstruments('NFO');
    
    // Filter for LAURUSLABS options with nearby strikes (within 20% of current price)
    const laurusOptions = allInstruments.filter(instrument => 
      instrument.name === 'LAURUSLABS' && 
      (instrument.instrument_type === 'CE' || instrument.instrument_type === 'PE') &&
      Math.abs(instrument.strike - currentPrice) <= currentPrice * 0.2 // ±20% strikes only
    );
    
    console.log(`📊 Found ${laurusOptions.length} nearby strike options`);
    
    // Batch the requests to avoid URI too long error
    const BATCH_SIZE = 100;
    const allQuotes = {};
    
    for (let i = 0; i < laurusOptions.length; i += BATCH_SIZE) {
      const batch = laurusOptions.slice(i, i + BATCH_SIZE);
      const batchTokens = batch.map(opt => `NFO:${opt.tradingsymbol}`);
      
      console.log(`📦 Fetching batch ${i/BATCH_SIZE + 1}/${Math.ceil(laurusOptions.length/BATCH_SIZE)}`);
      
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
    const optionsWithData = laurusOptions.map(option => {
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
    
    // Store in Redis
    await redis.set('options_cache', JSON.stringify({
      LAURUSLABS: activeOptions
    }));
    
    console.log('✅ Live options data populated successfully');
    
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

populateBatchedOptions();