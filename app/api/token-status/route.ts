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

export async function GET() {
  let redisClient = null;

  try {
    // First, check if Redis is configured
    if (!process.env.REDIS_URL) {
      return NextResponse.json({
        status: 'error',
        message: 'REDIS_URL not configured in environment variables',
        suggestion: 'Set REDIS_URL in Vercel dashboard → Settings → Environment Variables'
      }, { status: 500 });
    }

    redisClient = await getRedisClient();
    if (!redisClient) {
      return NextResponse.json({
        status: 'error',
        message: 'Failed to connect to Redis',
        redisUrl: process.env.REDIS_URL ? 'Present' : 'Missing'
      }, { status: 500 });
    }

    const tokenDataStr = await redisClient.get('kite_token');
    
    if (!tokenDataStr) {
      return NextResponse.json({
        status: 'error',
        message: 'No token found in Redis storage',
        suggestion: 'Run: npx ts-node scripts/instant-auth.ts YOUR_TOKEN'
      }, { status: 404 });
    }

    const tokenData = JSON.parse(tokenDataStr);
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
      storage: 'redis'
    });
    
  } catch (error) {
    console.error('Token status error:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Failed to read token from Redis',
      error: error instanceof Error ? error.message : 'Unknown error',
      redisUrl: process.env.REDIS_URL ? 'Configured' : 'Not configured'
    }, { status: 500 });
  } finally {
    if (redisClient) {
      await redisClient.quit();
    }
  }
}