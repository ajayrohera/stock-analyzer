// app/api/cron/update-volume/route.ts
import { NextRequest, NextResponse } from 'next/server';

// No longer need fs or path, as we are removing file-based logging.

export async function GET(request: NextRequest) {
  // Security check to ensure only Vercel's cron service can run this.
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // We log to the Vercel console, not a file.
    console.warn('[CRON-AUTH] Unauthorized access attempt to update-volume cron.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('🔄 [CRON] Starting scheduled volume update...');
    
    // Dynamically import the script to be executed.
    const { updateVolumeHistory } = await import('../../../../scripts/update-volume-history');
    await updateVolumeHistory();
    
    console.log('✅ [CRON] Volume update completed successfully.');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Volume history updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    // Log the final error to the Vercel console.
    console.error('❌ [CRON] A critical error occurred during the volume update:', errorMessage);
    
    return NextResponse.json({ 
      success: false, 
      error: errorMessage 
    }, { status: 500 });
  }
}