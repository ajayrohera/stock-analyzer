// app/api/test-fix/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const original = process.env.GOOGLE_PRIVATE_KEY;
  const replaced = original?.replace(/\\n/g, '\n');
  
  return NextResponse.json({
    originalEndsWith: original?.endsWith('KEY-----\\n'),
    replacedEndsWith: replaced?.endsWith('KEY-----\n'),
    containsNewlines: replaced?.includes('\n'),
    replacementWorked: replaced !== original,
    originalLast20: original?.substring(original.length - 20),
    replacedLast20: replaced?.substring(replaced.length - 20)
  });
}