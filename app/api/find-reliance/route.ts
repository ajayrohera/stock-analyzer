// app/api/find-reliance/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    const volumeHistory = await redisClient.get('volume_history');
    const parsedHistory = volumeHistory ? JSON.parse(volumeHistory) : {};
    
    // Find all keys containing "RELIANCE"
    const relianceKeys = Object.keys(parsedHistory).filter(key => 
      key.includes('RELIANCE') || key.includes('Reliance')
    );
    
    return NextResponse.json({
      success: true,
      relianceKeys,
      data: relianceKeys.length > 0 ? parsedHistory[relianceKeys[0]] : 'No reliance data found'
    });
    
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}