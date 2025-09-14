// app/api/redis-test/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const redis = await import('redis');
    
    // Mask sensitive info in logs
    const redisUrl = process.env.REDIS_URL || '';
    const maskedUrl = redisUrl.replace(/:[^:]*@/, ':****@');
    
    console.log('Attempting Redis connection to:', maskedUrl);
    
    const client = redis.createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    });

    // Add more detailed error handling
    client.on('error', (err) => {
      console.error('Redis connection error:', err.message);
      console.error('Error code:', err.code);
    });

    client.on('connect', () => console.log('Redis connecting...'));
    client.on('ready', () => console.log('Redis ready'));
    
    await client.connect();
    const testValue = await client.set('test', 'connection_works');
    const result = await client.get('test');
    await client.quit();
    
    return NextResponse.json({
      status: 'success',
      message: 'Redis connection successful',
      testResult: result,
      redisUrl: maskedUrl
    });
    
  } catch (error: any) {
    console.error('Detailed Redis error:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Redis connection failed',
      error: error.message,
      errorCode: error.code,
      redisUrl: process.env.REDIS_URL ? 'Configured' : 'Missing'
    }, { status: 500 });
  }
}