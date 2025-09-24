import { NextRequest, NextResponse } from 'next/server';
import { calculateDailyCandleTest } from '../../../../scripts/daily-candle-test';

export async function GET(request: NextRequest) {
  // Add auth check similar to your volume update cron
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await calculateDailyCandleTest();
    return NextResponse.json({ success: true, message: '3-candle test completed' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';