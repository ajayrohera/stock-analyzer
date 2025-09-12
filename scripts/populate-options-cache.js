// scripts/populate-options-cache.js
const { createClient } = require('redis');
const { KiteConnect } = require('kiteconnect');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function populateCache() {
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
    
    console.log('📡 Fetching instruments...');
    
    // Get NFO (Options) instruments
    const instruments = await kc.getInstruments('NFO');
    const optionsCache = {};
    
    // Group instruments by underlying symbol
    for (const instrument of instruments) {
      const symbol = instrument.name; // NIFTY, BANKNIFTY, etc.
      if (!optionsCache[symbol]) {
        optionsCache[symbol] = [];
      }
      optionsCache[symbol].push(instrument);
    }
    
    // Store in Redis
    await redis.set('options_cache', JSON.stringify(optionsCache));
    console.log('✅ Options cache populated successfully');
    console.log('📊 Symbols stored:', Object.keys(optionsCache));
    console.log('💾 Total instruments:', instruments.length);
    
  } catch (error) {
    console.error('❌ Error populating cache:', error.message);
  } finally {
    await redis.disconnect();
    console.log('👋 Disconnected from Redis');
  }
}

populateCache();