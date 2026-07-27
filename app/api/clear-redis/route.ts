// app/api/clear-redis/route.ts
//
// --- FIX: this route previously had NO authentication at all — a public
// GET endpoint that instantly deleted 'volume_history' (all historical
// data for every tracked stock) for anyone who visited the URL, whether
// intentionally, by accident, or via a bot/crawler. This is very likely
// what caused the "data collection reset to 0" symptom, coinciding with
// (but not actually caused by) a code deployment.
//
// Now requires the same CRON_SECRET bearer token already used to protect
// the token-refresh route, so it can still be triggered deliberately by
// you, but not by anyone/anything stumbling onto the URL.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET(request: NextRequest) {
  // --- FIX: require the same secret used elsewhere, instead of no auth at all.
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redisClient = createClient({ url: process.env.REDIS_URL });

  try {
    await redisClient.connect();
    await redisClient.del('volume_history');
    console.log('⚠️ volume_history manually cleared via authenticated request');
    return NextResponse.json({ success: true, message: 'Redis volume history cleared' });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}
