import { NextResponse } from 'next/server';
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL,
});

export async function GET() {
  try {
    await redis.connect();
    const tokenData = await redis.get('kite_token');
    await redis.disconnect();
    
    return NextResponse.json({ 
      status: tokenData ? 'TOKEN_EXISTS' : 'TOKEN_MISSING',
      tokenData: tokenData ? JSON.parse(tokenData) : null
    });
  } catch (error) {
    return NextResponse.json({ 
      status: 'ERROR',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}