// app/api/test-redis/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    const volumeHistory = await redisClient.get('volume_history');
    const kiteToken = await redisClient.get('kite_token');
    
    return NextResponse.json({
      volumeHistoryExists: !!volumeHistory,
      volumeHistoryLength: volumeHistory ? Object.keys(JSON.parse(volumeHistory)).length : 0,
      kiteTokenExists: !!kiteToken,
      redisConnected: redisClient.isOpen
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}