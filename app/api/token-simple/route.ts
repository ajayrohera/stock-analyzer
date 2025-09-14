// app/api/token-simple/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Check environment variables
    const hasRedisUrl = !!process.env.REDIS_URL;
    const hasApiKey = !!process.env.KITE_API_KEY;
    const hasRedisPassword = !!process.env.REDIS_PASSWORD;
    
    return NextResponse.json({
      status: 'success',
      environment: {
        hasRedisUrl,
        hasApiKey,
        hasRedisPassword,
        redisUrl: hasRedisUrl ? 'Configured' : 'Missing',
        apiKey: hasApiKey ? 'Configured' : 'Missing',
        nodeEnv: process.env.NODE_ENV || 'not set'
      },
      message: hasRedisUrl ? 
        'Redis is configured' : 
        'REDIS_URL environment variable missing - set it in Vercel dashboard'
    });
    
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      message: 'Status check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}