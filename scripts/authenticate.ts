// scripts/authenticate.ts
import { KiteConnect } from 'kiteconnect';
import redis from 'redis'; // Default import
import http from 'http';
import url from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const API_KEY = process.env.KITE_API_KEY;
const REDIS_URL = process.env.REDIS_URL;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

if (!API_KEY) {
  console.error('❌ KITE_API_KEY not found in environment variables');
  process.exit(1);
}

async function authenticate() {
  let redisClient: any = null;
  let server: http.Server | null = null;

  try {
    // Create Redis client with default import
    redisClient = redis.createClient({
      url: REDIS_URL as string,
      password: REDIS_PASSWORD as string
    });

    redisClient.on('error', (err: any) => console.log('Redis Client Error', err));
    
    await redisClient.connect();
    console.log('✅ Connected to Redis');

    const kc = new KiteConnect({
      api_key: API_KEY as string
    });

    console.log('🔗 Generating login URL...');
    const loginUrl = kc.getLoginURL();
    console.log('📋 Please visit this URL to login:');
    console.log(loginUrl);
    console.log('\n⏳ Waiting for authentication...');

    // Create server to capture redirect
    server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url!, true);
      
      if (parsedUrl.pathname === '/') {
        const requestToken = parsedUrl.query.request_token as string;
        
        if (requestToken) {
          try {
            console.log('🔄 Received request token, generating session...');
            
            // Get session
            const session = await kc.generateSession(requestToken, process.env.KITE_API_SECRET as string);
            console.log('✅ Session generated successfully');
            
            // Prepare token data
            const tokenData = {
              accessToken: session.access_token,
              refreshToken: session.refresh_token || '',
              loginTime: Date.now()
            };

            // Save to Redis with 24-hour expiration
            await redisClient.setEx('kite_token', 24 * 60 * 60, JSON.stringify(tokenData));
            console.log('✅ Token saved to Redis with 24-hour expiration');

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>Authentication Successful!</h1>
                  <p>Token saved to Redis storage.</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);

            server!.close();
            console.log('🎉 Authentication completed!');
            console.log('💾 Token saved to Redis');

          } catch (error: any) {
            console.error('❌ Failed to generate session:', error.message);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<h1>Authentication Failed</h1><p>Check terminal for details.</p>');
          }
        }
      }
    });

    server.listen(3000, () => {
      console.log('🌐 Authentication server running on http://localhost:3001');
    });

  } catch (error: any) {
    console.error('❌ Authentication failed:', error.message);
  } finally {
    // Cleanup
    if (server) {
      server.close();
    }
    if (redisClient) {
      await redisClient.quit();
    }
  }
}

// Run authentication
authenticate().catch(console.error);