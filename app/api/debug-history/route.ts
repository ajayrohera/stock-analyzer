// app/api/debug-history/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

interface HistoricalEntry {
  date: string;
  totalVolume: number;
  lastPrice?: number;
  timestamp: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'RELIANCE';
  
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    const volumeHistory = await redisClient.get('volume_history');
    
    if (!volumeHistory) {
      return NextResponse.json({ success: false, error: 'No volume history found' });
    }
    
    const history: Record<string, HistoricalEntry[]> = JSON.parse(volumeHistory);
    const symbolData = history[symbol.toUpperCase()] || [];
    
    // Calculate statistics
    const totalEntries = symbolData.length;
    const entriesWithVolume = symbolData.filter(entry => entry.totalVolume > 0);
    const avgVolume = entriesWithVolume.length > 0 
      ? Math.round(entriesWithVolume.reduce((sum, entry) => sum + entry.totalVolume, 0) / entriesWithVolume.length)
      : 0;
    
    return NextResponse.json({
      success: true,
      symbol: symbol.toUpperCase(),
      totalEntries,
      entriesWithVolume: entriesWithVolume.length,
      averageVolume: avgVolume,
      allEntries: symbolData,
      latestEntry: symbolData.length > 0 ? symbolData[symbolData.length - 1] : null,
      sampleEntries: symbolData.slice(-5) // Last 5 entries
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