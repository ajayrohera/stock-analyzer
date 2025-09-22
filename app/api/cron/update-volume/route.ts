// app/api/cron/update-volume/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // ADDED: Debug logging to track automatic vs manual runs
  console.log('🕒 CRON EXECUTION DEBUG:', {
    timestamp: new Date().toISOString(),
    timeIST: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    userAgent: request.headers.get('user-agent'),
    referer: request.headers.get('referer'),
    origin: request.headers.get('origin'),
    viaCron: request.headers.get('user-agent')?.includes('cron') ? 'YES' : 'NO',
    hasAuthHeader: !!request.headers.get('authorization')
  });

  // Security check to ensure only Vercel's cron service can run this.
  const authHeader = request.headers.get('authorization');
  
  // Allow both Vercel cron secret and direct calls (for testing)
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
      timestamp: new Date().toISOString(),
      executedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
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

// Required for Vercel Cron Jobs to work
export const dynamic = 'force-dynamic';