// app/api/cleanup/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

// Define the interface for historical data entries
interface HistoricalEntry {
  date: string;
  totalVolume: number;
  lastPrice?: number;
  timestamp: number;
}

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    const volumeHistory = await redisClient.get('volume_history');
    
    if (!volumeHistory) {
      return NextResponse.json({ success: true, message: 'No data to clean' });
    }
    
    const history: Record<string, HistoricalEntry[]> = JSON.parse(volumeHistory);
    let cleanedCount = 0;
    let totalEntries = 0;
    
    // Remove entries with zero volume
    for (const symbol in history) {
      const originalLength = history[symbol].length;
      totalEntries += originalLength;
      history[symbol] = history[symbol].filter((entry: HistoricalEntry) => entry.totalVolume > 0);
      cleanedCount += (originalLength - history[symbol].length);
    }
    
    await redisClient.set('volume_history', JSON.stringify(history));
    
    return NextResponse.json({
      success: true,
      message: `Cleaned ${cleanedCount} zero-volume entries out of ${totalEntries} total`,
      remainingSymbols: Object.keys(history).length,
      details: `Removed ${cleanedCount} entries with zero volume`
    });
    
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}