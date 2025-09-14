// app/api/token-status/route.ts
import { NextResponse } from 'next/server';

let redis: any = null;

async function initializeRedis() {
  if (!redis) {
    try {
      redis = (await import('redis')).default;
    } catch (error) {
      console.error('Failed to import redis:', error);
      return null;
    }
  }
  return redis;
}

async function getRedisClient() {
  const redis = await initializeRedis();
  if (!redis) return null;

  try {
    const client = redis.createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    });

    client.on('error', (err: any) => console.log('Redis Client Error', err));
    await client.connect();
    return client;
  } catch (error) {
    console.error('Redis connection failed:', error);
    return null;
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
function validateTokenConsistency(redisToken: any, envToken: any): boolean {
  if (redisToken && envToken) {
    const redisAccess = redisToken.accessToken || '';
    const envAccess = envToken.accessToken || '';
    
    if (redisAccess && envAccess && redisAccess !== envAccess) {
      console.warn('⚠️ Token mismatch between Redis and environment variable');
      console.warn('   Redis token:', redisAccess.substring(0, 10) + '...');
      console.warn('   Env token:  ', envAccess.substring(0, 10) + '...');
      
      const redisTime = redisToken.loginTime || 0;
      const envTime = envToken.loginTime || 0;
      console.warn('   Redis token age:', Math.floor((Date.now() - redisTime) / (1000 * 60 * 60)) + 'h');
      console.warn('   Env token age:  ', Math.floor((Date.now() - envTime) / (1000 * 60 * 60)) + 'h');
      
      return false;
    }
  }
  return true;
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

export async function GET() {
  let redisClient = null;

  try {
    let redisToken = null;
    let envToken = null;

    // Try to get token from Redis first
    redisClient = await getRedisClient();
    if (redisClient) {
      const tokenDataStr = await redisClient.get('kite_token');
      if (tokenDataStr) {
        redisToken = JSON.parse(tokenDataStr);
      }
    }

    // Fallback: Try environment variable
    envToken = getTokenFromEnv();

    // Validate consistency and synchronize if needed
    if (redisToken && envToken) {
      validateTokenConsistency(redisToken, envToken);
      
      if (redisClient) {
        await synchronizeTokens(redisClient, redisToken, envToken);
      }
    }

    let tokenData = null;
    let storageSource = 'unknown';

    // Choose the appropriate token source
    if (redisToken && envToken) {
      const redisTime = redisToken.loginTime || 0;
      const envTime = envToken.loginTime || 0;
      tokenData = redisTime > envTime ? redisToken : envToken;
      storageSource = redisTime > envTime ? 'redis' : 'env';
    } else if (redisToken) {
      tokenData = redisToken;
      storageSource = 'redis';
    } else if (envToken) {
      tokenData = envToken;
      storageSource = 'env';
    }

    if (!tokenData) {
      return NextResponse.json({
        status: 'error',
        message: 'No token found in Redis or environment variables',
        suggestion: 'Run authentication and set KITE_TOKEN_DATA environment variable'
      }, { status: 404 });
    }

    const loginTime = tokenData.loginTime || 0;
    const currentTime = Date.now();
    const tokenAgeHours = Math.floor((currentTime - loginTime) / (1000 * 60 * 60));

    return NextResponse.json({
      status: 'success',
      tokenExists: true,
      accessTokenPresent: !!tokenData.accessToken,
      refreshTokenPresent: !!tokenData.refreshToken,
      tokenAgeHours: tokenAgeHours,
      tokenCreated: new Date(loginTime).toISOString(),
      willExpireIn: `${24 - tokenAgeHours} hours`,
      isFresh: tokenAgeHours < 4,
      storage: storageSource,
      sourcesAvailable: {
        redis: !!redisToken,
        environment: !!envToken
      }
    });
    
  } catch (error) {
    console.error('Token status error:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Failed to read token',
      error: error instanceof Error ? error.message : 'Unknown error',
      redisAvailable: !!redisClient
    }, { status: 500 });
  } finally {
    if (redisClient) {
      await redisClient.quit();
    }
  }
}