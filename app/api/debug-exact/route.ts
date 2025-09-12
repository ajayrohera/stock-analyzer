// app/api/debug-exact/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  
  // Check what the actual character codes are
  const last10Chars = key?.substring(key.length - 10);
  const charCodes = last10Chars?.split('').map(char => char.charCodeAt(0));
  
  return NextResponse.json({
    last10Chars,
    charCodes,
    containsDoubleBackslash: key?.includes('\\\\'),
    containsBackslashN: key?.includes('\\n'),
    matchTest: key?.match(/\\\\n/g), // Test if regex matches
    splitTest: key?.split('\\n').length // Test split approach
  });
}