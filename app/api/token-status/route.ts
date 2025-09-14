// app/api/token-status/route.ts
import { NextResponse } from 'next/server';
import redis from 'redis'; // Default import

export async function GET() {
  let redisClient: any = null;

  try {
    // Create Redis client
    redisClient = redis.createClient({
      url: process.env.REDIS_URL!,
      password: process.env.REDIS_PASSWORD!
    });

    redisClient.on('error', (err: any) => console.log('Redis Client Error', err));
    await redisClient.connect();

    // Read from Redis
    const tokenDataStr = await redisClient.get('kite_token');
    
    if (!tokenDataStr) {
      return NextResponse.json({
        status: 'error',
        message: 'No token found in Redis storage'
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
    return NextResponse.json({
      status: 'error',
      message: 'Failed to read token from Redis',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  } finally {
    if (redisClient) {
      await redisClient.quit();
    }
  }
}