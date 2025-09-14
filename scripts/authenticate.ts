// Add proper error handling and debug logging
import { KiteConnect } from 'kiteconnect';
import http from 'http';
import url from 'url';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const API_KEY = process.env.KITE_API_KEY;
const TOKEN_PATH = path.join(process.cwd(), 'kite_token.json');

if (!API_KEY) {
  console.error('❌ KITE_API_KEY not found in environment variables');
  process.exit(1);
}

const kc = new KiteConnect({
  api_key: API_KEY
});

async function authenticate() {
  try {
    console.log('🔗 Generating login URL...');
    const loginUrl = kc.getLoginURL();
    console.log('📋 Please visit this URL to login:');
    console.log(loginUrl);
    console.log('\n⏳ Waiting for authentication...');

    // Create server to capture redirect
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url!, true);
      
      if (parsedUrl.pathname === '/') {
        const requestToken = parsedUrl.query.request_token as string;
        
        if (requestToken) {
          try {
            console.log('🔄 Received request token, generating session...');
            
            // Get session with detailed debugging
            const session = await kc.generateSession(requestToken, process.env.KITE_API_SECRET!);
            console.log('✅ Session generated successfully');
            console.log('📋 Session data:', {
              access_token: session.access_token ? 'PRESENT' : 'MISSING',
              refresh_token: session.refresh_token ? 'PRESENT' : 'MISSING',
              api_key: session.api_key ? 'PRESENT' : 'MISSING'
            });

            if (!session.refresh_token) {
              console.log('⚠️  WARNING: No refresh token received!');
              console.log('💡 This is normal for first-time authentication');
              console.log('💡 Subsequent authentications should provide refresh tokens');
            }

            // Save token data
            const tokenData = {
              accessToken: session.access_token,
              refreshToken: session.refresh_token || '', // Handle empty refresh token
              loginTime: Date.now()
            };

            await fs.writeFile(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
            console.log('💾 Token data saved to kite_token.json');
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>Authentication Successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                  <p>Refresh token: ${session.refresh_token ? '✅ Received' : '❌ Not received'}</p>
                </body>
              </html>
            `);

            server.close();
            console.log('🎉 Authentication completed!');
            console.log('📁 Token file created with access token');

          } catch (error: any) {
            console.error('❌ Failed to generate session:', error.message);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<h1>Authentication Failed</h1><p>Check terminal for details.</p>');
          }
        }
      }
    });

    server.listen(3000, () => {
      console.log('🌐 Authentication server running on http://localhost:3000');
    });

  } catch (error: any) {
    console.error('❌ Authentication failed:', error.message);
    process.exit(1);
  }
}

// Handle cases where refresh token might come later
async function main() {
  try {
    // Check if we already have a token
    try {
      const existingToken = JSON.parse(await fs.readFile(TOKEN_PATH, 'utf-8'));
      if (existingToken.accessToken) {
        console.log('ℹ️  Existing token found. Use update scripts instead.');
        return;
      }
    } catch {
      // No existing token, proceed with authentication
      await authenticate();
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

main();