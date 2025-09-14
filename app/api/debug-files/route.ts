import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const rootDir = process.cwd();
    
    // Check specific files we care about
    const filesToCheck = ['kite_token.json', 'package.json', 'vercel.json', 'next.config.js'];
    const results: any = {};

    for (const file of filesToCheck) {
      try {
        const stats = await fs.stat(path.join(rootDir, file));
        results[file] = {
          exists: true,
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
          created: stats.birthtime.toISOString()
        };
      } catch (error) {
        results[file] = {
          exists: false,
          error: error instanceof Error ? error.message : 'File not found'
        };
      }
    }

    return NextResponse.json({
      status: 'success',
      files: results,
      currentTime: new Date().toISOString()
    });
    
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      message: 'Debug failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}