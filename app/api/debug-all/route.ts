// app/api/debug-all/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    const volumeHistory = await redisClient.get('volume_history');
    const parsedHistory = volumeHistory ? JSON.parse(volumeHistory) : {};
    
    // Check which symbols actually have data
    const symbolsWithData = Object.keys(parsedHistory).filter(symbol => 
      parsedHistory[symbol] && parsedHistory[symbol].length > 0
    );
    
    const symbolsWithVolume = Object.keys(parsedHistory).filter(symbol =>
      parsedHistory[symbol] && parsedHistory[symbol].some((entry: any) => entry.totalVolume > 0)
    );
    
    return NextResponse.json({
      success: true,
      totalSymbols: Object.keys(parsedHistory).length,
      symbolsWithData: symbolsWithData.length,
      symbolsWithVolume: symbolsWithVolume.length,
      sampleSymbols: symbolsWithData.slice(0, 5),
      sampleData: symbolsWithData.length > 0 ? {
        symbol: symbolsWithData[0],
        data: parsedHistory[symbolsWithData[0]]
      } : 'No data'
    });
    
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: String(error) 
    }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}