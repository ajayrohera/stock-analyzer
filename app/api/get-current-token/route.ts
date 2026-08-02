// app/api/get-current-token/route.ts
//
// Returns the current Kite access_token already sitting in Redis
// (refreshed daily by the automated cron) — for use in other tools like
// the n8n screener workflow, without needing to run any manual login flow.
//
// Protected by the same CRON_SECRET used elsewhere.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redisClient = createClient({ url: process.env.REDIS_URL });

  try {
    await redisClient.connect();
    const tokenDataStr = await redisClient.get('kite_token');

    if (!tokenDataStr) {
      return NextResponse.json({ error: 'No token found in Redis. Refresh it first.' }, { status: 404 });
    }

    const tokenData = JSON.parse(tokenDataStr);
    return NextResponse.json({
      accessToken: tokenData.accessToken,
      loginTime: tokenData.loginTime,
      ageHours: ((Date.now() - tokenData.loginTime) / (1000 * 60 * 60)).toFixed(1),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}
