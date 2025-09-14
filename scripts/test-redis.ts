// scripts/test-redis.ts
import redis from 'redis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testRedis() {
  try {
    const redisClient = redis.createClient({
      url: process.env.REDIS_URL!,
      password: process.env.REDIS_PASSWORD!
    });

    await redisClient.connect();
    console.log('✅ Connected to Redis');
    
    const token = await redisClient.get('kite_token');
    if (token) {
      console.log('✅ Token found in Redis:');
      console.log(JSON.parse(token));
    } else {
      console.log('❌ No token found in Redis');
    }
    
    await redisClient.quit();
  } catch (error) {
    console.error('❌ Redis test failed:', error);
  }
}

testRedis();