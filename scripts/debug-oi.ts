// scripts/debug-oi.ts
import { KiteConnect } from 'kiteconnect';
import redis from 'redis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Fallback: Get token from environment variable
function getTokenFromEnv() {
  try {
    const envToken = process.env.KITE_TOKEN_DATA;
    if (!envToken) return null;
    return JSON.parse(envToken);
  } catch (error) {
    console.error('Failed to parse token from env:', error);
    return null;
  }
}

async function getTokenData() {
  let redisClient = null;
  let tokenData = null;

  try {
    // Try Redis first
    redisClient = redis.createClient({
      url: process.env.REDIS_URL as string,
      password: process.env.REDIS_PASSWORD as string
    });

    redisClient.on('error', (err) => console.log('Redis Client Error', err));
    await redisClient.connect();

    const tokenDataStr = await redisClient.get('kite_token');
    if (tokenDataStr) {
      tokenData = JSON.parse(tokenDataStr);
    }
  } catch (redisError) {
    console.log('Redis connection failed, trying environment variable...');
  } finally {
    if (redisClient) {
      await redisClient.quit();
    }
  }

  // Fallback to environment variable
  if (!tokenData) {
    tokenData = getTokenFromEnv();
  }

  return tokenData;
}

async function debugOI() {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) {
      throw new Error('KITE_API_KEY not set');
    }

    // Get token data
    const tokenData = await getTokenData();
    if (!tokenData) {
      throw new Error('No access token found. Please run authenticate.ts first');
    }

    if (!tokenData.accessToken) {
      throw new Error('Invalid token data: access token missing');
    }

    const kc = new KiteConnect({ api_key: apiKey }) as any;
    kc.setAccessToken(tokenData.accessToken);

    const symbols = ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'INFY'];
    
    console.log('🔍 Debugging OI Data from Kite Connect API');
    console.log('=' .repeat(50));

    for (const symbol of symbols) {
      const exchange = (symbol === 'NIFTY' || symbol === 'BANKNIFTY') ? 'NFO' : 'NSE';
      const instrumentId = `${exchange}:${symbol}`;
      
      try {
        console.log(`\n📊 ${symbol} (${exchange}):`);
        const quote = await kc.getQuote([instrumentId]);
        const data = quote[instrumentId];
        
        // Log all available fields (excluding internal ones)
        const availableFields = Object.keys(data).filter(k => !k.startsWith('_'));
        console.log('Available fields:', availableFields);
        
        // Check for OI fields
        const oiFields = availableFields.filter(k => 
          k.toLowerCase().includes('oi') || 
          k.toLowerCase().includes('interest') ||
          k.toLowerCase().includes('open_interest')
        );
        
        if (oiFields.length > 0) {
          console.log('✅ OI fields found:', oiFields);
          oiFields.forEach(field => {
            console.log(`   ${field}:`, data[field]);
          });
        } else {
          console.log('❌ No OI fields found in this instrument');
        }
        
        // Show basic data
        console.log('   Volume:', data.volume);
        console.log('   Last price:', data.last_price);
        console.log('   Instrument type:', data.instrument_token ? 'Valid' : 'Invalid');
        
      } catch (error: any) {
        console.log(`❌ Failed to get ${symbol}:`, error.message || 'Unknown error');
        if (error.code) {
          console.log(`   Error code: ${error.code}`);
        }
      }
    }
    
  } catch (error: any) {
    console.error('❌ Debug failed:', error.message || 'Unknown error');
    if (error.code) {
      console.log('Error code:', error.code);
    }
  }
}

// Run the debug
debugOI().catch(error => {
  console.error('Unhandled error:', error);
});