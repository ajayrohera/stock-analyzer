// scripts/instant-auth.ts
import { KiteConnect } from 'kiteconnect';
import redis from 'redis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function instantAuth(requestToken: string) {
  try {
    console.log('🚀 Starting instant authentication...');
    console.log('📋 Using request token:', requestToken);
    
    const kc = new KiteConnect({
      api_key: process.env.KITE_API_KEY!
    });

    console.log('🔄 Generating session...');
    const session = await kc.generateSession(requestToken, process.env.KITE_API_SECRET!);
    
    // Connect to Redis
    const redisClient = redis.createClient({
      url: process.env.REDIS_URL!,
      password: process.env.REDIS_PASSWORD!
    });

    redisClient.on('error', (err) => console.log('Redis Error:', err));
    await redisClient.connect();
    console.log('✅ Connected to Redis');

    // Save token to Redis
    const tokenData = {
      accessToken: session.access_token,
      refreshToken: session.refresh_token || '',
      loginTime: Date.now()
    };

    await redisClient.setEx('kite_token', 24 * 60 * 60, JSON.stringify(tokenData));
    await redisClient.quit();
    
    console.log('✅ SUCCESS! Token saved to Redis');
    console.log('📋 Token details:');
    console.log('   Access Token: ✅ Present');
    console.log('   Refresh Token:', session.refresh_token ? '✅ Present' : '❌ Not provided');
    console.log('   Expires: 24 hours from now');
    
  } catch (error: any) {
    console.error('❌ Authentication failed:', error.message);
    if (error.message.includes('invalid') || error.message.includes('expired')) {
      console.log('💡 The request token has expired. Get a new one by visiting the login URL again.');
    }
  }
}

// Get token from command line argument or use placeholder
const requestToken = process.argv[2] || 'PASTE_NEW_TOKEN_HERE';

if (requestToken === 'PASTE_NEW_TOKEN_HERE') {
  console.log('❌ Please provide a fresh request token:');
  console.log('   npx ts-node scripts/instant-auth.ts YOUR_NEW_TOKEN_HERE');
  console.log('\n📋 Get a new token by visiting:');
  console.log('   https://kite.zerodha.com/connect/login?api_key=tpwjbkqec6xshvau&v=3');
} else {
  instantAuth(requestToken);
}