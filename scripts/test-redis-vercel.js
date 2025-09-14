// scripts/test-redis-vercel.js
import { createClient } from 'redis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function testVercelConnection() {
  console.log('🧪 Testing Redis connection (simulating Vercel environment)...');
  
  // Mask the password in logs for security
  const redisUrl = process.env.REDIS_URL || '';
  const maskedUrl = redisUrl.replace(/:[^:]*@/, ':****@');
  console.log('🔗 Redis URL:', maskedUrl);
  console.log('🔑 Redis Password:', process.env.REDIS_PASSWORD ? '*** set ***' : 'missing');
  
  if (!process.env.REDIS_URL) {
    console.log('❌ REDIS_URL environment variable is missing');
    return;
  }

  let client;
  try {
    // Create Redis client (same as Vercel would)
    client = createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    });

    // Add detailed error handling
    client.on('error', (err) => {
      console.log('❌ Redis error event:', err.message);
      console.log('🔍 Error code:', err.code);
      if (err.code === 'ECONNREFUSED') {
        console.log('💡 This usually means:');
        console.log('   - Firewall blocking connection');
        console.log('   - IP not whitelisted');
        console.log('   - Redis server down');
      }
    });

    client.on('connect', () => console.log('🔄 Connecting to Redis...'));
    client.on('ready', () => console.log('✅ Redis connection ready!'));

    console.log('⏳ Attempting connection...');
    await client.connect();
    
    // Test basic operations
    console.log('🧪 Testing read/write operations...');
    await client.set('vercel_test', 'connection_successful');
    const result = await client.get('vercel_test');
    
    console.log('🎉 SUCCESS! Redis connection works locally');
    console.log('📋 Test result:', result);
    
  } catch (error) {
    console.log('❌ Connection failed with error:');
    console.log('   Message:', error.message);
    console.log('   Code:', error.code);
    
    if (error.stack) {
      console.log('   Stack:', error.stack.split('\n')[0]); // First line of stack
    }
    
    if (error.code === 'NOSCRIPT') {
      console.log('💡 This might be a Redis version compatibility issue');
    }
    
  } finally {
    if (client) {
      await client.quit();
      console.log('🔌 Redis connection closed');
    }
  }
}

// Run the test
testVercelConnection();