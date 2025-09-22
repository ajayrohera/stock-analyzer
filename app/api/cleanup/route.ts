// Create a temporary cleanup endpoint
// app/api/cleanup/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    const volumeHistory = await redisClient.get('volume_history');
    
    if (!volumeHistory) {
      return NextResponse.json({ success: true, message: 'No data to clean' });
    }
    
    const history = JSON.parse(volumeHistory);
    let cleanedCount = 0;
    
    // Remove entries with zero volume
    for (const symbol in history) {
      const originalLength = history[symbol].length;
      history[symbol] = history[symbol].filter(entry => entry.totalVolume > 0);
      cleanedCount += (originalLength - history[symbol].length);
    }
    
    await redisClient.set('volume_history', JSON.stringify(history));
    
    return NextResponse.json({
      success: true,
      message: `Cleaned ${cleanedCount} zero-volume entries`,
      remainingSymbols: Object.keys(history).length
    });
    
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}