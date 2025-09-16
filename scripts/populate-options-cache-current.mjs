// scripts/populate-options-cache-current.mjs
import { createClient } from 'redis';
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    
    // Get NFO instruments
    const instruments = await kc.getInstruments('NFO');
    
    // FILTER FOR CURRENT SERIES ONLY (September/October 2024)
    const currentDate = new Date();
    const currentSeries = instruments.filter(instrument => {
      const expiryDate = new Date(instrument.expiry);
      // Only include instruments expiring in the next 60 days
      const daysToExpiry = (expiryDate - currentDate) / (1000 * 60 * 60 * 24);
      return daysToExpiry > 0 && daysToExpiry <= 60;
    });
    
    console.log(`📊 Filtered to ${currentSeries.length} current series instruments (from ${instruments.length} total)`);
    
    const optionsCache = {};
    
    // Group instruments by underlying symbol
    for (const instrument of currentSeries) {
      const symbol = instrument.name;
      if (!optionsCache[symbol]) {
        optionsCache[symbol] = [];
      }
      optionsCache[symbol].push(instrument);
    }
    
    // Store in Redis
    await redis.set('options_cache', JSON.stringify(optionsCache));
    console.log('✅ Options cache populated with CURRENT series only');
    console.log('📊 Symbols stored:', Object.keys(optionsCache));
    
    // Show sample of LAURUSLABS instruments
    if (optionsCache['LAURUSLABS']) {
      console.log('🔍 LAURUSLABS instruments:');
      optionsCache['LAURUSLABS'].slice(0, 5).forEach(inst => {
        console.log(`   ${inst.tradingsymbol} - Expiry: ${inst.expiry}, Strike: ${inst.strike}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error populating cache:', error.message);
  } finally {
    await redis.disconnect();
    console.log('👋 Disconnected from Redis');
  }
}

populateCache();