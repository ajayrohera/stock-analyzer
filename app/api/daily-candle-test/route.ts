import { NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  
  const client = createClient({ url: process.env.REDIS_URL! });
  
  try {
    await client.connect();
    
    // Get all daily candle test results from Redis
    const dailyCandleTestData = await client.get('daily_candle_test');
    
    if (!dailyCandleTestData) {
      return NextResponse.json({ 
        success: true, 
        data: null,
        message: 'No daily candle test data available yet' 
      });
    }
    
    const allResults = JSON.parse(dailyCandleTestData);
    
    // If specific symbol requested, return only that symbol's data
    if (symbol) {
      const symbolData = allResults[symbol.toUpperCase()];
      return NextResponse.json({ 
        success: true, 
        data: symbolData || null,
        available: !!symbolData
      });
    }
    
    // Return all results
    return NextResponse.json({ 
      success: true, 
      data: allResults,
      count: Object.keys(allResults).length
    });
    
  } catch (error: any) {
    console.error('Error fetching daily candle test data:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  } finally {
    await client.quit();
  }
}