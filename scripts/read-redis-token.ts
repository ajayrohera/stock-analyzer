// scripts/read-redis-token.ts
import { createClient } from 'redis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

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
    
    console.log('\n📊 Token details:');
    console.log('   Access Token:', tokenData.accessToken ? '✅ Present' : '❌ Missing');
    console.log('   Refresh Token:', tokenData.refreshToken ? '✅ Present' : '❌ Missing');
    console.log('   Token age:', tokenAgeHours, 'hours');
    console.log('   Expires in:', 24 - tokenAgeHours, 'hours');
    
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

readRedisToken();