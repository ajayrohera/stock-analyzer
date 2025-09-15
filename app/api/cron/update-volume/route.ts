// app/api/cron/update-volume/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Log file path
const CRON_LOG_FILE = path.join(process.cwd(), 'cron-log.json');

async function logCronExecution(success: boolean, message: string) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      success,
      message,
      type: 'volume_update'
    };

    // Read existing logs
    let logs = [];
    try {
      const existingData = await fs.readFile(CRON_LOG_FILE, 'utf-8');
      logs = JSON.parse(existingData);
    } catch {
      // File doesn't exist yet
    }

    // Add new log entry (keep last 30 days)
    logs.push(logEntry);
    logs = logs.slice(-30); // Keep only last 30 entries

    await fs.writeFile(CRON_LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (error) {
    console.error('Failed to write cron log:', error);
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    await logCronExecution(false, 'Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('🔄 [CRON] Starting scheduled volume update...');
    
    const { updateVolumeHistory } = await import('../../../../scripts/update-volume-history');
    await updateVolumeHistory();
    
    await logCronExecution(true, 'Volume history updated successfully');
    console.log('✅ [CRON] Volume update completed successfully');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Volume history updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await logCronExecution(false, `Failed: ${errorMessage}`);
    console.error('❌ [CRON] Volume update failed:', errorMessage);
    
    return NextResponse.json({ 
      success: false, 
      error: errorMessage 
    }, { status: 500 });
  }
}