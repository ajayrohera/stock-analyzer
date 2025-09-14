// scripts/update-volume-history.ts
import { KiteConnect } from 'kiteconnect';
import redis from 'redis';
import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const volumeHistoryPath = path.join(process.cwd(), 'volume_history.json');

// Helper function to safely parse JSON
async function safeReadJson(filePath: string): Promise<any> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

// Fallback: Get token from environment variable
function getTokenFromEnv() {
  try {
    const envToken = process.env.KITE_TOKEN_DATA;
    if (!envToken) return null;
    
    return JSON.parse(envToken);
  } catch (error) {
    console.error('Failed to parse token from env:', error);
    return null;
  }
}

// Validate token consistency between sources
function validateTokenConsistency(redisToken: any, envToken: any): void {
  if (redisToken && envToken) {
    const redisAccess = redisToken.accessToken || '';
    const envAccess = envToken.accessToken || '';
    
    if (redisAccess && envAccess && redisAccess !== envAccess) {
      console.warn('⚠️ Token mismatch between Redis and environment variable');
      
      const redisTime = redisToken.loginTime || 0;
      const envTime = envToken.loginTime || 0;
      console.warn('   Redis token age:', Math.floor((Date.now() - redisTime) / (1000 * 60 * 60)) + 'h');
      console.warn('   Env token age:  ', Math.floor((Date.now() - envTime) / (1000 * 60 * 60)) + 'h');
      
      if (redisTime > envTime) {
        console.log('   Using Redis token (newer)');
      } else {
        console.log('   Using env token (newer)');
      }
    }
  }
}

// Synchronize tokens between sources
async function synchronizeTokens(redisClient: any, redisToken: any, envToken: any) {
  if (!redisToken || !envToken) return;
  
  const redisTime = redisToken.loginTime || 0;
  const envTime = envToken.loginTime || 0;
  
  // If environment is newer, update Redis
  if (envTime > redisTime + 60000 && redisClient) { // 1 minute threshold
    try {
      await redisClient.setEx('kite_token', 24 * 60 * 60, JSON.stringify(envToken));
      console.log('🔄 Updated Redis with newer environment token');
    } catch (error) {
      console.log('⚠️ Could not update Redis with newer token:', error);
    }
  }
}

// Helper function to refresh token
async function refreshAccessToken(kc: any, tokenData: any): Promise<any> {
  try {
    console.log('🔄 Token expired, attempting refresh...');
    
    if (!process.env.KITE_API_SECRET) {
      throw new Error('KITE_API_SECRET not set for token refresh');
    }

    const refreshResponse = await kc.renewAccessToken(tokenData.refreshToken, process.env.KITE_API_SECRET!);
    
    const newTokenData = {
      accessToken: refreshResponse.access_token,
      refreshToken: refreshResponse.refresh_token,
      loginTime: Date.now()
    };
    
    // Try to update Redis if available
    try {
      const redisClient = redis.createClient({
        url: process.env.REDIS_URL as string,
        password: process.env.REDIS_PASSWORD as string
      });

      redisClient.on('error', (err) => console.log('Redis Client Error', err));
      await redisClient.connect();
      await redisClient.setEx('kite_token', 24 * 60 * 60, JSON.stringify(newTokenData));
      await redisClient.quit();
      console.log('✅ Token refreshed and saved to Redis');
    } catch (redisError) {
      console.log('⚠️ Could not save to Redis, token refreshed in memory only');
    }
    
    return newTokenData;
  } catch (error) {
    console.error('❌ Token refresh failed:', error);
    throw new Error('Token refresh failed. Please re-authenticate by running authenticate.ts');
  }
}

// Get all symbols
async function getAllSymbols(): Promise<string[]> {
  try {
    if (process.env.NODE_ENV === 'production') {
      return ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'TATASTEEL', 'INFY'];
    }
    
    const auth = new google.auth.GoogleAuth({ 
      keyFile: path.join(process.cwd(), 'credentials.json'), 
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly' 
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1NeUJ-N3yNAhtLN0VPV71vY88MTTAYGEW8gGxtNbVcRU',
      range: 'stocks!A2:A',
    });
    
    return response.data.values?.flat().filter(Boolean) || [];
  } catch (error) {
    console.error('Error fetching symbols, using default set:', error);
    return ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'TATASTEEL', 'INFY'];
  }
}

async function updateVolumeHistory() {
  let redisClient = null;

  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) throw new Error('KITE_API_KEY not set');
    
    let redisToken = null;
    let envToken = null;
    let tokenData = null;

    // Try to connect to Redis first
    try {
      redisClient = redis.createClient({
        url: process.env.REDIS_URL as string,
        password: process.env.REDIS_PASSWORD as string
      });

      redisClient.on('error', (err) => console.log('Redis Client Error', err));
      await redisClient.connect();
      console.log('✅ Connected to Redis');

      // Try to get token from Redis
      const tokenDataStr = await redisClient.get('kite_token');
      if (tokenDataStr) {
        redisToken = JSON.parse(tokenDataStr);
      }
    } catch (redisError) {
      console.log('⚠️ Redis connection failed, trying environment variable...');
    }

    // Get environment token
    envToken = getTokenFromEnv();

    // Validate consistency and synchronize if needed
    if (redisToken && envToken) {
      validateTokenConsistency(redisToken, envToken);
      
      if (redisClient) {
        await synchronizeTokens(redisClient, redisToken, envToken);
      }
    }

    // Choose the appropriate token source
    if (redisToken && envToken) {
      const redisTime = redisToken.loginTime || 0;
      const envTime = envToken.loginTime || 0;
      tokenData = redisTime > envTime ? redisToken : envToken;
      console.log(`🔑 Using ${redisTime > envTime ? 'Redis' : 'environment'} token`);
    } else if (redisToken) {
      tokenData = redisToken;
      console.log('🔑 Using Redis token');
    } else if (envToken) {
      tokenData = envToken;
      console.log('🔑 Using environment token');
    }

    if (!tokenData) {
      throw new Error('No access token found in Redis or environment variables. Please run authenticate.ts first');
    }

    if (!tokenData.accessToken) {
      throw new Error('Invalid token data: access token missing');
    }

    // Get all symbols to track
    const symbols = await getAllSymbols();
    if (symbols.length === 0) throw new Error('No symbols found');
    
    console.log(`📊 Found ${symbols.length} symbols to update`);

    // Initialize KiteConnect
    const kc = new KiteConnect({
      api_key: apiKey
    }) as any;
    
    kc.setAccessToken(tokenData.accessToken);

    // Load existing history
    let history: Record<string, Array<{date: string, totalVolume: number, timestamp: number}>> = await safeReadJson(volumeHistoryPath);
    
    // Fetch latest data for all symbols
    const today = new Date().toISOString().split('T')[0];
    const timestamp = Date.now();
    let updatedCount = 0;
    let failedCount = 0;

    for (const symbol of symbols) {
      try {
        // Determine exchange based on symbol type
        const exchange = (symbol === 'NIFTY' || symbol === 'BANKNIFTY') ? 'NFO' : 'NSE';
        const tradingsymbol = symbol;
        
        let quote;
        try {
          quote = await kc.getQuote([`${exchange}:${tradingsymbol}`]);
        } catch (error: any) {
          // If token expired, refresh and retry
          if (error.message.includes('token') || error.message.includes('expired') || error.message.includes('invalid') || error.message.includes('401')) {
            const newTokenData = await refreshAccessToken(kc, tokenData);
            kc.setAccessToken(newTokenData.accessToken);
            quote = await kc.getQuote([`${exchange}:${tradingsymbol}`]);
          } else {
            throw error;
          }
        }
        
        const data = quote[`${exchange}:${tradingsymbol}`];
        
        if (data && data.volume !== undefined) {
          if (!history[symbol]) history[symbol] = [];
          
          // Remove old entry for today if it exists
          history[symbol] = history[symbol].filter(entry => entry.date !== today);
          
          // Add new entry
          history[symbol].push({
            date: today,
            totalVolume: data.volume,
            timestamp: timestamp
          });
          
          // Keep only last 20 days
          const twentyDaysAgo = timestamp - (20 * 24 * 60 * 60 * 1000);
          history[symbol] = history[symbol].filter(entry => entry.timestamp > twentyDaysAgo);
          
          updatedCount++;
          process.stdout.write(`✅ ${symbol} `);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`\n❌ Failed to update ${symbol}:`, errorMessage);
        failedCount++;
      }
    }
    
    // Save updated history
    await fs.writeFile(volumeHistoryPath, JSON.stringify(history, null, 2));
    console.log(`\n\n📈 Successfully updated volume history for ${updatedCount}/${symbols.length} symbols`);
    if (failedCount > 0) {
      console.log(`❌ Failed to update ${failedCount} symbols`);
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('❌ Volume update failed:', errorMessage);
    
    // If it's a token error, we need manual reauthentication
    if (errorMessage.includes('token') || errorMessage.includes('expired') || errorMessage.includes('invalid')) {
      console.log('\n⚠️  Token needs manual refresh. Please run: npx ts-node scripts/authenticate.ts');
    }
    
    process.exit(1);
  } finally {
    // Cleanup Redis connection
    if (redisClient) {
      await redisClient.quit();
    }
  }
}

// ES module way to check if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  updateVolumeHistory();
}

export { updateVolumeHistory };