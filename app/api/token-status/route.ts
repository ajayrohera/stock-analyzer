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

// FALLBACK: Get token from environment variable
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

export async function GET() {
  let redisClient = null;

  try {
    // First try Redis
    redisClient = await getRedisClient();
    let tokenData = null;

    if (redisClient) {
      const tokenDataStr = await redisClient.get('kite_token');
      if (tokenDataStr) {
        tokenData = JSON.parse(tokenDataStr);
      }
    }

    // FALLBACK: If Redis fails or no token, try environment variable
    if (!tokenData) {
      tokenData = getTokenFromEnv();
      if (tokenData) {
        console.log('⚠️ Using token from environment variable fallback');
      }
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
      storage: redisClient ? 'redis' : 'env_fallback' // Show source
    });
    
  } catch (error) {
    console.error('Token status error:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Failed to read token',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  } finally {
    if (redisClient) {
      await redisClient.quit();
    }
  }
}