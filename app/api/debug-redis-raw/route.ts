// app/api/debug-redis-raw/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL,
});

export async function GET() {
  try {
    await redis.connect();
    const allKeys = await redis.keys('*');
    const values: Record<string, any> = {};
    
    for (const key of allKeys) {
      // Get raw value without parsing
      values[key] = await redis.get(key);
    }
    
    await redis.disconnect();
    
    return NextResponse.json({ 
      keys: allKeys,
      values: values
    });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}