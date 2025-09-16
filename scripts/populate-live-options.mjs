// scripts/populate-live-options.mjs
import { createClient } from 'redis';
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function populateLiveOptions() {
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
    
    console.log('📡 Fetching current options chain for LAURUSLABS...');
    
    // Get current options chain for LAURUSLABS (this should return current series)
    const quoteData = await kc.getQuote(['NFO:LAURUSLABS']);
    
    // Get the actual current options series from the quote data
    const currentOptions = [];
    
    // Extract options data from quote response
    for (const [key, data] of Object.entries(quoteData)) {
      if (key.includes('LAURUSLABS') && (key.includes('CE') || key.includes('PE'))) {
        currentOptions.push({
          tradingsymbol: key.replace('NFO:', ''),
          instrument_token: data.instrument_token,
          last_price: data.last_price,
          oi: data.oi || 0,
          volume: data.volume || 0
        });
      }
    }
    
    console.log(`📊 Found ${currentOptions.length} current options for LAURUSLABS`);
    
    // Store in Redis
    await redis.set('options_cache', JSON.stringify({
      LAURUSLABS: currentOptions
    }));
    
    console.log('✅ Live options cache populated successfully');
    console.log('Sample options:', currentOptions.slice(0, 5));
    
  } catch (error) {
    console.error('❌ Error populating live options:', error.message);
  } finally {
    await redis.disconnect();
    console.log('👋 Disconnected from Redis');
  }
}

populateLiveOptions();