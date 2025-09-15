// scripts/read-redis-token.ts
import { createClient } from 'redis';
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Helper function to validate token with Kite servers
async function validateTokenWithKite(accessToken: string): Promise<{ isValid: boolean; error?: string }> {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) {
      return { isValid: false, error: 'KITE_API_KEY not set' };
    }

    const kc = new KiteConnect({ api_key: apiKey }) as any;
    kc.setAccessToken(accessToken);

    // Try a simple API call to validate token
    const profile = await kc.getProfile();
    
    return { 
      isValid: true,
      error: undefined
    };
    
  } catch (error: any) {
    return { 
      isValid: false, 
      error: error.message || 'Unknown validation error' 
    };
  }
}

async function readRedisToken() {
  console.log('📖 Reading token from Redis...');
  
  const redisUrl = process.env.REDIS_URL || '';
  const maskedUrl = redisUrl.replace(/:[^:]*@/, ':****@');
  console.log('🔗 Redis URL:', maskedUrl);
  
  let client;
  try {
    client = createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    });

    await client.connect();
    console.log('✅ Connected to Redis');

    // Read the actual token
    const tokenDataStr = await client.get('kite_token');
    
    if (!tokenDataStr) {
      console.log('❌ No kite_token found in Redis');
      return;
    }

    const tokenData = JSON.parse(tokenDataStr);
    
    console.log('🎯 Token found in Redis:');
    console.log(JSON.stringify(tokenData, null, 2));
    
    // Calculate token age
    const loginTime = tokenData.loginTime || 0;
    const currentTime = Date.now();
    const tokenAgeHours = Math.floor((currentTime - loginTime) / (1000 * 60 * 60));
    const hoursUntilExpiry = 24 - tokenAgeHours;
    
    console.log('\n📊 Token details:');
    console.log('   Access Token:', tokenData.accessToken ? '✅ Present' : '❌ Missing');
    console.log('   Refresh Token:', tokenData.refreshToken ? '✅ Present' : '❌ Missing');
    console.log('   Token age:', tokenAgeHours, 'hours');
    console.log('   Expires in:', hoursUntilExpiry, 'hours');
    
    // Validate with Kite servers
    if (tokenData.accessToken) {
      console.log('\n🔐 Validating token with Kite servers...');
      const validation = await validateTokenWithKite(tokenData.accessToken);
      
      if (validation.isValid) {
        console.log('✅ Token validity with Kite: VALID');
        console.log('   Token is accepted by Kite servers');
      } else {
        console.log('❌ Token validity with Kite: INVALID');
        console.log('   Error:', validation.error);
        console.log('   💡 Token may have been revoked by Kite');
        console.log('   💡 Run: npx ts-node scripts/authenticate.ts');
      }
    } else {
      console.log('❌ Cannot validate - no access token found');
    }
    
    // Format for environment variable
    console.log('\n📋 For Vercel environment variable (KITE_TOKEN_DATA):');
    console.log(JSON.stringify(tokenData));
    
  } catch (error) {
    console.error('❌ Error reading token:', error);
  } finally {
    if (client) {
      await client.quit();
    }
  }
}

// ES module way to check if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  readRedisToken();
}

export { readRedisToken, validateTokenWithKite };