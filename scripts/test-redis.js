// scripts/test-redis.js
const { createClient } = require('redis');
const dotenv = require('dotenv');
const path = require('path');

// Load from .env.local instead of .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testRedis() {
  try {
    console.log('🔗 Testing Redis connection...');
    console.log('Redis URL:', process.env.REDIS_URL);
    
    if (!process.env.REDIS_URL) {
      throw new Error('REDIS_URL is undefined. Check your .env.local file');
    }

    const redis = createClient({
      url: process.env.REDIS_URL,
    });

    redis.on('error', (err) => {
      console.log('❌ Redis Client Error:', err.message);
    });

    console.log('🔄 Connecting...');
    await redis.connect();
    
    console.log('✅ Connected successfully!');
    
    await redis.set('test', 'hello');
    const value = await redis.get('test');
    console.log('✅ Test value:', value);
    
    await redis.disconnect();
    console.log('✅ Disconnected successfully');
    
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
  }
}

testRedis();