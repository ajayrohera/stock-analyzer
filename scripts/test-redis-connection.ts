// scripts/test-redis-connection.ts
import redis from 'redis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testRedisConnection() {
  try {
    console.log('Testing Redis connection...');
    console.log('Redis URL:', process.env.REDIS_URL?.replace(/:[^:]*@/, ':****@'));
    
    const client = redis.createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    });

    client.on('error', (err) => {
      console.error('Redis error:', err.message);
      console.error('Error code:', err.code);
    });

    client.on('connect', () => console.log('Connecting...'));
    client.on('ready', () => console.log('Connected!'));
    
    await client.connect();
    
    // Test write/read
    await client.set('test_key', 'Hello Redis!');
    const value = await client.get('test_key');
    
    console.log('✅ Redis test successful!');
    console.log('Test value:', value);
    
    await client.quit();
    
  } catch (error: any) {
    console.error('❌ Redis test failed:');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
  }
}

testRedisConnection();