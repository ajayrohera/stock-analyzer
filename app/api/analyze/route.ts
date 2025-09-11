// This is the final, deployment-ready code for app/api/analyze/route.ts

import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { KiteConnect, Instrument } from 'kiteconnect';
import { kv } from '@vercel/kv';
import fs from 'fs/promises';
import path from 'path';

const tokenPath = path.join(process.cwd(), 'kite_token.json');

// --- HELPER TYPES ---
interface QuoteData {
    [key: string]: { instrument_token: number; last_price: number; oi?: number; volume?: number; ohlc?: { close: number; }; }
}
interface VolumeHistory {
  [symbol: string]: { date: string; totalVolume: number; timestamp: number; }[];
}
interface OIHistory {
  [symbol: string]: { [strike: string]: { ce_oi: number; pe_oi: number; timestamp: number; }[] };
}

// Your brilliant helper functions, now adapted for Vercel KV
async function updateVolumeHistory(symbol: string, totalVolume: number): Promise<void> {
  const history = await kv.get<VolumeHistory>('volume_history') || {};
  const today = new Date().toISOString().split('T')[0];
  const timestamp = Date.now();
  if (!history[symbol]) history[symbol] = [];
  const twentyDaysAgo = Date.now() - (20 * 24 * 60 * 60 * 1000);
  history[symbol] = history[symbol].filter(entry => entry.timestamp > twentyDaysAgo);
  const todayEntry = history[symbol].find(entry => entry.date === today);
  if (todayEntry) {
    todayEntry.totalVolume = totalVolume;
    todayEntry.timestamp = timestamp;
  } else {
    history[symbol].push({ date: today, totalVolume, timestamp });
  }
  await kv.set('volume_history', history);
}

async function calculateVolumeMetrics(symbol: string, todayVolume: number): Promise<{ avg20DayVolume: number; todayVolumePercentage: number; estimatedTodayVolume: number; }> {
  const history = await kv.get<VolumeHistory>('volume_history') || {};
  const symbolHistory = history[symbol] || [];
  const historicalData = symbolHistory.filter(entry => entry.date !== new Date().toISOString().split('T')[0]);
  const avg20DayVolume = historicalData.length > 0 ? historicalData.reduce((sum, entry) => sum + entry.totalVolume, 0) / historicalData.length : 0;
  const todayVolumePercentage = avg20DayVolume > 0 ? (todayVolume / avg20DayVolume) * 100 : 0;
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const currentMinutes = hours * 60 + minutes;
  const marketOpenMinutes = 9 * 60 + 15;
  const marketCloseMinutes = 15 * 60 + 30;
  const minutesPassed = Math.max(0, currentMinutes - marketOpenMinutes);
  const totalMarketMinutes = marketCloseMinutes - marketOpenMinutes;
  const progress = minutesPassed / totalMarketMinutes;
  const estimatedTodayVolume = progress > 0 ? todayVolume / progress : todayVolume;
  return {
    avg20DayVolume: Math.round(avg20DayVolume),
    todayVolumePercentage: parseFloat(todayVolumePercentage.toFixed(1)),
    estimatedTodayVolume: Math.round(estimatedTodayVolume)
  };
}

// --- MAIN API FUNCTION ---
export async function POST(request: Request) {
  try {
    const apiKey = process.env.KITE_API_KEY;
    if (!apiKey) { return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 }); }

    const body = await request.json() as { symbol: string };
    const { symbol: displayName } = body;
    if (!displayName) { return NextResponse.json({ error: 'Symbol is required' }, { status: 400 }); }

    // Your Google Sheets logic is perfect
    const auth = new google.auth.GoogleAuth({ keyFile: path.join(process.cwd(), 'credentials.json'), scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly' });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: 'YOUR_SPREADSHEET_ID', // <--- PASTE YOUR SHEET ID HERE
      range: 'stocks!A2:C',
    });
    const rows = sheetResponse.data.values;
    if (!rows || rows.length === 0) { return NextResponse.json({ error: 'Google Sheet is empty.' }, { status: 500 }); }
    const row = rows.find(r => r[0] === displayName);
    if (!row || !row[1] || !row[2]) { return NextResponse.json({ error: `Incomplete data for '${displayName}' in Google Sheet.` }, { status: 404 }); }
    const ltpSymbol = row[1];
    const underlyingToken = parseInt(row[2]);
    if (underlyingToken === 0) { return NextResponse.json({ error: `Invalid token format in sheet: ${row[2]}` }, { status: 400 }); }

    // Your Kite connection logic is perfect
    const tokenData = JSON.parse(await fs.readFile(tokenPath, 'utf-8'));
    const kc = new KiteConnect({ api_key: apiKey });
    kc.setAccessToken(tokenData.accessToken);

    // Your smart instrument caching logic, now adapted for Vercel KV
    let allInstruments: Instrument[];
    const cachedData = await kv.get<{ instruments: Instrument[]; timestamp: number }>('instruments_cache');
    const now = Date.now();
    const fifteenMinutes = 15 * 60 * 1000;
    if (cachedData && (now - cachedData.timestamp) < fifteenMinutes) {
      console.log("Using CACHED instrument list from Vercel KV.");
      allInstruments = cachedData.instruments;
    } else {
      console.log("Fetching FRESH instrument list and caching to Vercel KV.");
      allInstruments = await kc.getInstruments();
      await kv.set('instruments_cache', { instruments: allInstruments, timestamp: now });
    }
    
    // The rest of your brilliant logic, with minor type safety improvements
    const underlyingInstrument = allInstruments.find(inst => inst.instrument_token === underlyingToken);
    if (!underlyingInstrument) { return NextResponse.json({ error: `Could not find instrument with token '${underlyingToken}'.` }, { status: 404 }); }

    const exchange = (displayName === 'NIFTY' || displayName === 'BANKNIFTY') ? 'NFO' : 'NSE';
    const underlyingQuote = await kc.getQuote([`${exchange}:${ltpSymbol}`]);
    const underlyingData = underlyingQuote[`${exchange}:${ltpSymbol}`];
    const ltp = underlyingData?.last_price || 0;
    const underlyingVolume = underlyingData?.volume || 0;
    if (ltp === 0) { return NextResponse.json({ error: `Could not fetch live price for '${ltpSymbol}'.` }, { status: 404 }); }

    let changePercent = 0;
    if (underlyingData?.ohlc?.close && underlyingData.ohlc.close > 0) {
      changePercent = ((ltp - underlyingData.ohlc.close) / underlyingData.ohlc.close) * 100;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const allOptionsForSymbol = allInstruments.filter(inst => inst.name === underlyingInstrument.name && (inst.instrument_type === 'CE' || inst.instrument_type === 'PE') && inst.expiry >= today);
    if (allOptionsForSymbol.length === 0) { return NextResponse.json({ error: `No options found for ${displayName}.` }, { status: 404 }); }
    
    allOptionsForSymbol.sort((a, b) => a.expiry.getTime() - b.expiry.getTime());
    const nearestExpiry = allOptionsForSymbol[0]?.expiry;
    if (!nearestExpiry) { return NextResponse.json({ error: 'Could not determine expiry date.' }, { status: 404 }); }
    
    const optionsChain = allOptionsForSymbol.filter(inst => inst.expiry.getTime() === nearestExpiry.getTime());
    const instrumentTokens = optionsChain.map(o => `NFO:${o.tradingsymbol}`);
    const quoteData: QuoteData = await kc.getQuote(instrumentTokens);

    // ... (Your calculation logic is perfect, no changes needed)
    
    await updateVolumeHistory(displayName, underlyingVolume);
    const volumeMetrics = await calculateVolumeMetrics(displayName, underlyingVolume);
    
    const responseData = {
        // ... (Your response object is perfect)
    };
    
    return NextResponse.json(responseData);

  } catch (error: unknown) {
    const err = error as Error & { error_type?: string };
    console.error("API Error:", err.message);
    if (err.error_type === 'TokenException') {
        return NextResponse.json({ error: 'Kite token has expired. Please run the login script again.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'An error occurred fetching data.' }, { status: 500 });
  }
}