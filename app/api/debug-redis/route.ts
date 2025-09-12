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
      const value = await redis.get(key);
      try {
  values[key] = value ? JSON.parse(value) : value;
} catch {
  values[key] = value; // Keep as string if not JSON
}
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