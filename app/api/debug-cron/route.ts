// app/api/debug-cron/route.ts
import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';

export async function GET() {
  const redisClient = createClient({ url: process.env.REDIS_URL });
  
  try {
    await redisClient.connect();
    
    // 1. Check Redis connection
    console.log('🔌 Redis connected:', redisClient.isOpen);
    
    // 2. Check Google Sheets connection
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
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'stocks!A2:B',
    });

    const rows = response.data.values || [];
    console.log('📊 Google Sheets rows:', rows.length);
    
    // 3. Check Kite token
    const tokenData = await redisClient.get('kite_token');
    console.log('🔑 Kite token exists:', !!tokenData);
    
    if (tokenData) {
      const kc = new KiteConnect({ api_key: process.env.KITE_API_KEY! });
      kc.setAccessToken(JSON.parse(tokenData).accessToken);
      
      // Test with RELIANCE
      try {
        const quote = await kc.getQuote(['NSE:RELIANCE']);
        console.log('📡 Kite API RELIANCE quote:', quote);
      } catch (error) {
        console.error('❌ Kite API error:', error);
      }
    }
    
    // 4. Check existing Redis data
    const volumeHistory = await redisClient.get('volume_history');
    console.log('📦 Redis volume history:', volumeHistory ? 'Exists' : 'Null');
    
    return NextResponse.json({
      success: true,
      redisConnected: redisClient.isOpen,
      sheetsRows: rows.length,
      kiteToken: !!tokenData,
      volumeHistory: volumeHistory ? 'Exists' : 'Null'
    });
    
  } catch (error) {
    console.error('❌ Debug error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}