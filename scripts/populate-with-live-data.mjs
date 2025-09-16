// scripts/populate-with-live-data.mjs
import { createClient } from 'redis';
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function populateWithLiveData() {
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
    
    // First, let's get the actual underlying stock quote to know current price
    const underlyingQuote = await kc.getQuote(['NSE:LAURUSLABS']);
    const currentPrice = underlyingQuote['NSE:LAURUSLABS']?.last_price;
    
    console.log('💰 LAURUSLABS Current Price:', currentPrice);
    
    if (!currentPrice) {
      throw new Error('Could not fetch current price for LAURUSLABS');
    }
    
    // Get ALL instruments to find options
    const allInstruments = await kc.getInstruments('NFO');
    
    // Filter for LAURUSLABS options with nearby strikes
    const laurusOptions = allInstruments.filter(instrument => 
      instrument.name === 'LAURUSLABS' && 
      instrument.instrument_type === 'CE' || instrument.instrument_type === 'PE'
    );
    
    console.log(`📊 Found ${laurusOptions.length} LAURUSLABS options`);
    
    // Get live quotes for these options
    const optionTokens = laurusOptions.map(opt => `NFO:${opt.tradingsymbol}`);
    const quotes = await kc.getQuote(optionTokens);
    
    // Prepare data with live OI values
    const optionsWithData = laurusOptions.map(option => {
      const quote = quotes[`NFO:${option.tradingsymbol}`];
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
      console.log(`   ${opt.tradingsymbol}: OI=${opt.oi}, Price=${opt.last_price}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await redis.disconnect();
    console.log('👋 Disconnected from Redis');
  }
}

populateWithLiveData();