// app/api/debug-key/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  
  return NextResponse.json({
    privateKeyExists: !!privateKey,
    length: privateKey?.length,
    startsWith: privateKey?.startsWith('-----BEGIN PRIVATE KEY-----'),
    endsWith: privateKey?.endsWith('-----END PRIVATE KEY-----'),
    containsNewlines: privateKey?.includes('\n'),
    first100Chars: privateKey?.substring(0, 100),
    last100Chars: privateKey?.substring(Math.max(0, privateKey.length - 100))
  });
}