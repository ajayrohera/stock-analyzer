// app/api/hard-reset/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    
    // COMPLETELY clear Redis
    await redisClient.flushAll();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Redis completely cleared. Run cron job during market hours to repopulate with fresh data.' 
    });
    
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}