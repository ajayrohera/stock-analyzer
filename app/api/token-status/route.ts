// app/api/token-status/route.ts.
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const tokenPath = path.join(process.cwd(), 'kite_token.json');
    
    // Read the token file from Vercel's file system
    let tokenData;
    try {
      const fileContent = await fs.readFile(tokenPath, 'utf-8');
      tokenData = JSON.parse(fileContent);
    } catch (error) {
      return NextResponse.json({
        status: 'error',
        message: 'Token file not found or invalid',
        error: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }

    // Check token age
    const loginTime = tokenData.loginTime || 0;
    const currentTime = Date.now();
    const tokenAgeHours = Math.floor((currentTime - loginTime) / (1000 * 60 * 60));
    
    // Check if token has refresh capability
    const hasRefreshToken = !!tokenData.refreshToken;
    
    return NextResponse.json({
      status: 'success',
      tokenExists: true,
      accessTokenPresent: !!tokenData.accessToken,
      refreshTokenPresent: hasRefreshToken,
      tokenAgeHours: tokenAgeHours,
      tokenCreated: new Date(loginTime).toISOString(),
      willExpireIn: `${24 - tokenAgeHours} hours`,
      isFresh: tokenAgeHours < 4, // Less than 4 hours old
      fileLastModified: (await fs.stat(tokenPath)).mtime.toISOString()
    });
    
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      message: 'Failed to check token status',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}