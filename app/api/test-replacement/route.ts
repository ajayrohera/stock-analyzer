// app/api/test-replacement/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const original = process.env.GOOGLE_PRIVATE_KEY;
  const replaced = original?.replace(/\\\\n/g, '\n');
  
  return NextResponse.json({
    originalLength: original?.length,
    replacedLength: replaced?.length,
    originalEndsWith: original?.endsWith('-----END PRIVATE KEY-----\\n'),
    replacedEndsWith: replaced?.endsWith('-----END PRIVATE KEY-----\n'),
    containsActualNewlines: replaced?.includes('\n'),
    first50AfterReplace: replaced?.substring(0, 50),
    last50AfterReplace: replaced?.substring(Math.max(0, replaced.length - 50))
  });
}