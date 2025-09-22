// app/api/debug-reliance/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    const volumeHistory = await redisClient.get('volume_history');
    const parsedHistory = volumeHistory ? JSON.parse(volumeHistory) : {};
    
    const relianceData = parsedHistory['RELIANCE'] || [];
    
    return NextResponse.json({
      success: true,
      symbol: 'RELIANCE',
      entries: relianceData.length,
      data: relianceData,
      latestEntry: relianceData.length > 0 ? relianceData[relianceData.length - 1] : null
    });
    
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}