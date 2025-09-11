import { NextResponse } from 'next/server';

export async function GET() {
  const envVars = {
    KITE_API_KEY: process.env.KITE_API_KEY ? 'SET' : 'MISSING',
    GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID ? 'SET' : 'MISSING',
    GOOGLE_PRIVATE_KEY_ID: process.env.GOOGLE_PRIVATE_KEY_ID ? 'SET' : 'MISSING',
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY ? 
      `SET (length: ${process.env.GOOGLE_PRIVATE_KEY.length})` : 'MISSING',
    GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL ? 'SET' : 'MISSING',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? 'SET' : 'MISSING',
    GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID ? 'SET' : 'MISSING',
    // Add any other environment variables you want to check
  };

  console.log('Environment variables check:', envVars);

  return NextResponse.json({
    status: 'Environment variables check',
    environment: process.env.NODE_ENV,
    variables: envVars,
    timestamp: new Date().toISOString()
  });
}