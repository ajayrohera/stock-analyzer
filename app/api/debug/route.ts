// app/api/debug/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const tokenPath = path.join(process.cwd(), 'kite_token.json');
    
    // Check if token file exists
    let tokenContent = 'NOT_FOUND';
    try {
      tokenContent = await fs.readFile(tokenPath, 'utf-8');
    } catch (error) {
      tokenContent = 'FILE_NOT_FOUND';
    }
    
    // Check environment variable (will be masked for security)
    const apiKeyExists = !!process.env.KITE_API_KEY;
    
    return NextResponse.json({
      tokenFileExists: tokenContent !== 'FILE_NOT_FOUND',
      tokenContent: tokenContent !== 'FILE_NOT_FOUND' ? 'PRESENT_BUT_MASKED' : 'MISSING',
      apiKeyConfigured: apiKeyExists,
      environment: process.env.NODE_ENV,
      vercelRegion: process.env.VERCEL_REGION
    });
  } catch (error) {
    return NextResponse.json({ error: 'Debug failed' }, { status: 500 });
  }
}