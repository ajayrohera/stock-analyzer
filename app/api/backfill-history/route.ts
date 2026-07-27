// app/api/backfill-history/route.ts
//
// ONE-TIME USE: backfills volume_history with REAL historical daily data
// (via Kite's Historical Data API — genuine exchange data, not fabricated)
// for the last ~15 calendar days, instead of waiting day-by-day for the
// regular update-volume cron to slowly rebuild it after a reset.
//
// Uses the exact same data format as update-volume-history.ts:
//   { date, totalVolume, lastPrice, timestamp }
// keyed by symbol.displayName.toUpperCase(), so it merges cleanly with
// whatever the regular daily cron does going forward.
//
// Protected by the same CRON_SECRET used elsewhere — this should only be
// run deliberately, not automatically.

import { NextRequest, NextResponse } from 'next/server';
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';
import { google } from 'googleapis';

async function getAllSymbols(): Promise<{ displayName: string; tradingSymbol: string }[]> {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
    },
    scopes: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'stocks!A2:B',
  });
  const rows = response.data.values || [];
  return rows
    .filter(r => r[0] && r[1])
    .map(r => ({ displayName: r[0].trim(), tradingSymbol: r[1].trim() }));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redisClient = createClient({ url: process.env.REDIS_URL });

  try {
    await redisClient.connect();

    // 1. Get valid Kite token
    const tokenDataStr = await redisClient.get('kite_token');
    if (!tokenDataStr) {
      return NextResponse.json({ error: 'No Kite token found in Redis. Refresh it first.' }, { status: 400 });
    }
    const tokenData = JSON.parse(tokenDataStr);

    const kc = new KiteConnect({ api_key: process.env.KITE_API_KEY! });
    kc.setAccessToken(tokenData.accessToken);

    // 2. Get symbols to backfill
    let symbols = await getAllSymbols();

    // --- NEW: optional ?limit=N to test on a small batch first, e.g.
    // /api/backfill-history?limit=5 — before committing to all 235 stocks
    // on the first ever run of this against live Kite servers.
    const limitParam = request.nextUrl.searchParams.get('limit');
    if (limitParam) {
      const limit = parseInt(limitParam, 10);
      if (!isNaN(limit) && limit > 0) {
        symbols = symbols.slice(0, limit);
        console.log(`🧪 TEST MODE: limiting to first ${limit} symbols`);
      }
    }

    console.log(`📊 Backfilling history for ${symbols.length} symbols...`);

    // 3. Get full NSE instrument list to map tradingSymbol -> instrument_token
    const allInstruments = await kc.getInstruments('NSE');
    const instrumentMap = new Map<string, number>();
    for (const inst of allInstruments) {
      // --- FIX: guard against any malformed entries in Kite's full NSE
      // instrument list (tens of thousands of rows) that might be missing
      // a tradingsymbol — one bad entry was crashing the ENTIRE route
      // before it even reached the per-symbol loop below.
      if (inst && inst.tradingsymbol) {
        instrumentMap.set(inst.tradingsymbol.toUpperCase(), inst.instrument_token);
      }
    }

    // 4. Load existing history to merge into (don't overwrite what's already there)
    const existingHistoryStr = await redisClient.get('volume_history');
    const history: Record<string, any[]> = existingHistoryStr ? JSON.parse(existingHistoryStr) : {};

    const toDate = new Date();
    const fromDate = new Date();
    // --- FIX: 15 calendar days only contains ~10-11 actual TRADING days
    // (weekends have no data), which would satisfy Volume (needs 5) and
    // A/D Line (needs 10) but fall short of RSI's 14-day requirement.
    // All three indicators share the SAME underlying day count in this
    // app (confirmed in the dataSufficiency code — they just check
    // different thresholds against one shared historicalDataLength), so
    // satisfying the highest requirement (RSI's 14) automatically
    // satisfies the other two. 25 calendar days comfortably covers 14+
    // trading days even accounting for a holiday or two in the window.
    fromDate.setDate(fromDate.getDate() - 25);

    const fmt = (d: Date) => d.toISOString().split('T')[0];

    let successCount = 0;
    let failCount = 0;
    const failedSymbols: string[] = [];

    for (const symbol of symbols) {
      // --- FIX: same defensive guard as the instrument map above
      if (!symbol.tradingSymbol || !symbol.displayName) {
        failCount++;
        failedSymbols.push(`(malformed sheet row, skipped)`);
        continue;
      }
      const instrumentToken = instrumentMap.get(symbol.tradingSymbol.toUpperCase());
      if (!instrumentToken) {
        failCount++;
        failedSymbols.push(`${symbol.displayName} (no instrument token found)`);
        continue;
      }

      try {
        const candles = await kc.getHistoricalData(
          instrumentToken,
          'day',
          fmt(fromDate),
          fmt(toDate),
          false
        );

        const key = symbol.displayName.toUpperCase();
        if (!history[key]) history[key] = [];

        for (const candle of candles) {
          const dateStr = new Date(candle.date).toISOString().split('T')[0];
          // Remove any existing entry for this date before adding, to avoid duplicates
          history[key] = history[key].filter((e: any) => e.date !== dateStr);
          history[key].push({
            date: dateStr,
            totalVolume: candle.volume,
            lastPrice: candle.close,
            timestamp: new Date(candle.date).getTime(),
          });
        }

        // Sort by date and keep last 30, same as the regular cron
        history[key].sort((a: any, b: any) => a.date.localeCompare(b.date));
        history[key] = history[key].slice(-30);

        successCount++;
        console.log(`✅ Backfilled ${symbol.displayName}: ${candles.length} days`);
      } catch (error: any) {
        failCount++;
        failedSymbols.push(`${symbol.displayName} (${error.message})`);
        console.error(`❌ Failed to backfill ${symbol.displayName}:`, error.message);
      }

      // Kite rate limit is ~3 req/sec — stay safely under that
      await sleep(350);
    }

    await redisClient.set('volume_history', JSON.stringify(history));

    return NextResponse.json({
      success: true,
      symbolsProcessed: symbols.length,
      successCount,
      failCount,
      failedSymbols: failedSymbols.slice(0, 20), // cap in case of many failures
    });
  } catch (error: any) {
    console.error('❌ Backfill failed:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}
