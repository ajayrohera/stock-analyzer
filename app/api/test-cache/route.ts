import { NextResponse } from 'next/server';
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL,
});

export async function GET() {
  try {
    await redis.connect();
    const cache = await redis.get('options_cache');
    await redis.disconnect();
    
    return NextResponse.json({ 
      status: cache ? 'CACHE_EXISTS' : 'CACHE_MISSING',
      cacheKeys: cache ? Object.keys(JSON.parse(cache)) : [],
      cacheSample: cache ? Object.keys(JSON.parse(cache)).slice(0, 5) : []
    });
  } catch (error) {
    return NextResponse.json({ 
      status: 'ERROR',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}