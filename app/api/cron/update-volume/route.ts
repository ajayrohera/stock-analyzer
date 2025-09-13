// app/api/cron/update-volume/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Simple authentication check
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Import your existing function - CORRECT PATH
    const { updateVolumeHistory } = await import('../../../../scripts/update-volume-history');
    
    // Call your existing function
    await updateVolumeHistory();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Volume history updated successfully'
    });

  } catch (error) {
    // Proper error handling
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Volume update failed:', errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Also add POST method for cron jobs
export async function POST(request: NextRequest) {
  // Same implementation as GET
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { updateVolumeHistory } = await import('../../../../scripts/update-volume-history');
    await updateVolumeHistory();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Volume history updated successfully'
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Volume update failed:', errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}