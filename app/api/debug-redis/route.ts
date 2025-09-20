// app/api/debug-redis/route.ts
import { NextResponse } from 'next/server';
import { createClient } from 'redis';

async function getRedisData(key: string) {
  const client = createClient({ url: process.env.REDIS_URL });
  try {
    await client.connect();
    return await client.get(key);
  } finally {
    await client.quit();
  }
}

export async function GET() {
  try {
    const volumeHistory = await getRedisData('volume_history');
    const parsedHistory = volumeHistory ? JSON.parse(volumeHistory) : {};
    
    // Get first 3 symbols as sample
    const sampleSymbols = Object.keys(parsedHistory).slice(0, 3);
    const sampleData: any = {};
    
    sampleSymbols.forEach(symbol => {
      sampleData[symbol] = parsedHistory[symbol];
    });
    
    return NextResponse.json({
      success: true,
      totalSymbols: Object.keys(parsedHistory).length,
      allSymbols: Object.keys(parsedHistory),
      sampleData: sampleData
    });
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: String(error) 
    }, { status: 500 });
  }
}