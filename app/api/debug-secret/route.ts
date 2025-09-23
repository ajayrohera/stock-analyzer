// In /api/debug-secret/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    cronSecret: process.env.CRON_SECRET ? 'SET' : 'NOT SET',
    secretLength: process.env.CRON_SECRET?.length,
    secretPreview: process.env.CRON_SECRET ? 
      `${process.env.CRON_SECRET.substring(0, 5)}...` : 'none'
  });
}