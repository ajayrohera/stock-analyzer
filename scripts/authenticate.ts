// scripts/authenticate.ts
import { KiteConnect } from 'kiteconnect';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const tokenPath = path.join(process.cwd(), 'kite_token.json');

async function authenticate() {
  const apiKey = process.env.KITE_API_KEY;
  if (!apiKey) {
    console.error('❌ KITE_API_KEY not set');
    process.exit(1);
  }

  if (!process.env.KITE_API_SECRET) {
    console.error('❌ KITE_API_SECRET not set');
    process.exit(1);
  }

  try {
    const kc = new KiteConnect({ api_key: apiKey });
    
    console.log('🔗 Please visit this URL to authenticate:');
    console.log(kc.getLoginURL());
    console.log('\n📋 After logging in, copy the "request_token" from the redirect URL');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('📝 Request token: ', async (requestToken) => {
      try {
        console.log('🔄 Generating session...');
        
        // For kiteconnect v5.1.0, use generateSession
        const sessionData = await kc.generateSession(requestToken, process.env.KITE_API_SECRET!);
        
        console.log('✅ Session data received:', {
          access_token_length: sessionData.access_token?.length,
          refresh_token_length: sessionData.refresh_token?.length
        });
        
        if (!sessionData.refresh_token) {
          throw new Error('No refresh token received from Kite Connect');
        }
        
        const tokenData = {
          accessToken: sessionData.access_token,
          refreshToken: sessionData.refresh_token,
          loginTime: Date.now()
        };
        
        await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
        console.log('✅ Token saved successfully!');
        console.log('✅ Access Token:', tokenData.accessToken.substring(0, 20) + '...');
        console.log('✅ Refresh Token:', tokenData.refreshToken.substring(0, 20) + '...');
        
        rl.close();
        process.exit(0);
        
      } catch (error) {
        console.error('❌ Authentication failed:', error);
        rl.close();
        process.exit(1);
      }
    });
    
  } catch (error) {
    console.error('❌ KiteConnect initialization failed:', error);
    process.exit(1);
  }
}

authenticate().catch(console.error);