// scripts/kite-login.js (ES Modules version)
import { createClient } from 'redis';
import { KiteConnect } from 'kiteconnect';
import dotenv from 'dotenv';
import readline from 'readline';
import open from 'open';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const redis = createClient({
  url: process.env.REDIS_URL,
});

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function login() {
  try {
    console.log('🔗 Connecting to Redis...');
    await redis.connect();
    
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) {
      throw new Error('KITE_API_KEY environment variable is missing');
    }

    const kc = new KiteConnect({
      api_key: apiKey
    });

    // Generate login URL
    const loginUrl = kc.getLoginURL();
    console.log('\n🌐 Please visit this URL to login:');
    console.log(loginUrl);
    
    // Try to open the URL in browser
    try {
      await open(loginUrl);
      console.log('📂 Opened login page in your browser...');
    } catch (error) {
      console.log('⚠️  Could not open browser automatically. Please copy the URL above.');
    }

    // Ask for the request token from the redirect URL
    rl.question('\n🔑 Paste the request token from the redirect URL (after "request_token="): ', async (requestToken) => {
      try {
        console.log('\n🔄 Generating session...');
        const session = await kc.generateSession(requestToken, process.env.KITE_API_SECRET);
        
        // Store the access token in Redis
        const tokenData = {
          accessToken: session.access_token,
          publicToken: session.public_token,
          loginTime: new Date().toISOString()
        };
        
        await redis.set('kite_token', JSON.stringify(tokenData));
        console.log('✅ Login successful! Token stored in Redis.');
        console.log('📝 Access Token:', session.access_token);
        
      } catch (error) {
        console.error('❌ Login failed:', error.message);
      } finally {
        await redis.disconnect();
        rl.close();
        process.exit(0);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    await redis.disconnect();
    process.exit(1);
  }
}

// Handle Ctrl+C
rl.on('close', () => {
  console.log('\n👋 Goodbye!');
  process.exit(0);
});

login();