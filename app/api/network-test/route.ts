// app/api/network-test/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Test if we can reach external services
    const testUrl = 'https://api.vercel.com/v1/';
    const response = await fetch(testUrl);
    
    return NextResponse.json({
      status: 'success',
      message: 'Network connectivity test',
      canReachVercelApi: response.ok,
      redisUrl: process.env.REDIS_URL ? 'Configured' : 'Missing'
    });
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      message: 'Network test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}