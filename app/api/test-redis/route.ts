// app/api/test-redis/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  let redis;
  try {
    // Use Redis client directly (NOT @vercel/kv)
    redis = createClient({
      url: process.env.REDIS_URL,
    });
    
    await redis.connect();
    const result = await redis.ping();
    
    return NextResponse.json({ 
      status: 'Redis connected successfully',
      ping: result 
    });
    
  } catch (error) {
    return NextResponse.json({ 
      status: 'Redis connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  } finally {
    if (redis) {
      await redis.disconnect();
    }
  }
}