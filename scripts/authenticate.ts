// scripts/authenticate.ts
import { KiteConnect } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const tokenPath = path.join(process.cwd(), 'kite_token.json');

async function authenticate() {
  const apiKey = process.env.KITE_API_KEY;
  if (!apiKey) {
    console.error('❌ KITE_API_KEY not set in environment variables');
    console.error('💡 Make sure you have a .env.local file with KITE_API_KEY and KITE_API_SECRET');
    process.exit(1);
  }

  if (!process.env.KITE_API_SECRET) {
    console.error('❌ KITE_API_SECRET not set in environment variables');
    process.exit(1);
  }

  try {
    // Initialize KiteConnect
    const kc = new KiteConnect({
      api_key: apiKey
    });
    
    console.log('🔗 Please visit this URL to authenticate:');
    console.log(kc.getLoginURL());
    console.log('\n📋 After logging in, you will be redirected to a URL.');
    console.log('💡 Copy the "request_token" parameter from that URL and paste it below.');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('📝 Request token: ', async (requestToken) => {
      try {
        // Use generateSession for initial authentication
        const sessionData = await kc.generateSession(requestToken, process.env.KITE_API_SECRET!);
        
        const tokenData = {
          accessToken: sessionData.access_token,
          refreshToken: sessionData.refresh_token,
          loginTime: Date.now()
        };
        
        await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
        console.log('\n✅ Authentication successful!');
        console.log('✅ Token saved to:', tokenPath);
        console.log('✅ Access Token:', sessionData.access_token.substring(0, 20) + '...');
        console.log('✅ Refresh Token:', sessionData.refresh_token.substring(0, 20) + '...');
        console.log('\n🚀 You can now run the volume update script.');
        
        rl.close();
        process.exit(0);
        
      } catch (error) {
        console.error('\n❌ Authentication failed:');
        if (error instanceof Error) {
          console.error('Error:', error.message);
        } else {
          console.error('Unknown error:', error);
        }
        rl.close();
        process.exit(1);
      }
    });
    
  } catch (error) {
    console.error('❌ KiteConnect initialization failed:', error);
    process.exit(1);
  }
}

// Run authentication
authenticate().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});