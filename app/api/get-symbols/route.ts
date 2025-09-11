// This is the final and correct code for app/api/get-symbols/route.ts
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import type { Instrument } from 'kiteconnect';

export async function GET() {
  try {
    const allInstruments = await kv.get<Instrument[]>('instruments_cache');
    if (!allInstruments || allInstruments.length === 0) {
      return NextResponse.json({ error: 'Instrument cache is empty.' }, { status: 500 });
    }
    const uniqueNames = new Set<string>();
    for (const inst of allInstruments) {
      if (inst.segment === 'NFO-OPT') {
        uniqueNames.add(inst.name);
      }
    }
    const sortedSymbols = Array.from(uniqueNames).sort();
    return NextResponse.json(sortedSymbols);
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Error fetching from KV:", err.message);
    return NextResponse.json({ error: 'Failed to load symbol list from cloud storage.' }, { status: 500 });
  }
}