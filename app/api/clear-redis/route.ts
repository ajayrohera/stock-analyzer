// app/api/clear-redis/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    await redisClient.del('volume_history');
    return NextResponse.json({ success: true, message: 'Redis volume history cleared' });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}