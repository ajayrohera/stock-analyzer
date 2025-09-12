// app/api/debug-google/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    sheetId: process.env.GOOGLE_SHEET_ID,
    hasPrivateKey: !!process.env.GOOGLE_PRIVATE_KEY,
    privateKeyLength: process.env.GOOGLE_PRIVATE_KEY?.length
  });
}