import { NextResponse } from 'next/server';
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { google } from 'googleapis';

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL! });
  await client.connect();
  return client;
}

export async function POST(request: Request) {
  try {
    const { symbol } = await request.json();
    
    if (!symbol) {
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    }

    const redis = await getRedisClient();
    const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY! });

    // Get token
    const tokenData = await redis.get('kite_token');
    if (!tokenData) {
      return NextResponse.json({ error: 'Kite token not found' }, { status: 401 });
    }
    kite.setAccessToken(JSON.parse(tokenData).accessToken);

    // Get symbol mapping
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly'
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID!,
      range: 'stocks!A2:B'
    });
    
    const row = response.data.values?.find(r => r[0] === symbol);
    if (!row || !row[1]) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
    }

    const tradingSymbol = row[1];
    const exchange = (symbol === 'NIFTY' || symbol === 'BANKNIFTY') ? 'NFO' : 'NSE';
    const instrumentToken = `${exchange}:${tradingSymbol}`;

    // Test 1: Try to get today's 5-minute candles
    const today = new Date().toISOString().split('T')[0];
    
    console.log(`Testing historical data for ${symbol} (${instrumentToken}) on ${today}`);
    
    let historicalData;
    try {
      historicalData = await kite.getHistoricalData(
        instrumentToken,
        '5minute',
        today,
        today,
        false,
        false
      );
    } catch (error) {
      console.error('Historical API error:', error);
      return NextResponse.json({ 
        success: false, 
        error: 'Historical API failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Test 2: Try minute data (1-minute candles)
    let minuteData;
    try {
      minuteData = await kite.getHistoricalData(
        instrumentToken,
        'minute', 
        today,
        today,
        false,
        false
      );
    } catch (error) {
      console.error('Minute data error:', error);
    }

    await redis.quit();

    return NextResponse.json({
      success: true,
      symbol,
      instrumentToken,
      today,
      historicalData: {
        available: !!historicalData,
        type: '5minute',
        dataCount: historicalData ? historicalData.length : 0,
        sample: historicalData ? historicalData.slice(0, 3) : null
      },
      minuteData: {
        available: !!minuteData,
        type: 'minute', 
        dataCount: minuteData ? minuteData.length : 0,
        sample: minuteData ? minuteData.slice(0, 5) : null
      },
      message: historicalData ? 
        `Found ${historicalData.length} 5-minute candles` : 
        'No historical data available'
    });

  } catch (error) {
    console.error('Test endpoint error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}