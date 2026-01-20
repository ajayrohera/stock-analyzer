// app/api/get-symbols/route.ts

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function fetchActiveFnOSymbols(): Promise<string[]> {
  const response = await fetch('https://api.kite.trade/instruments', {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch instruments: ${response.status}`);
  }

  const csvText = await response.text();
  const lines = csvText.split('\n');

  const symbolsSet = new Set<string>();

  for (const line of lines.slice(1)) {
    if (!line) continue;

    const cols = line.split(',');

    const tradingsymbol = cols[2];
    const exchange = cols[11];
    const segment = cols[12];

    if (exchange === 'NFO' && segment === 'NFO-OPT') {
      const rootSymbol = tradingsymbol.replace(/\d.*$/, '');
      if (rootSymbol) {
        symbolsSet.add(rootSymbol);
      }
    }
  }

  return Array.from(symbolsSet).sort();
}

export async function GET() {
  try {
    const symbols = await fetchActiveFnOSymbols();
    return Response.json(symbols, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      }
    });
  } catch (error) {
    console.error('get-symbols error:', error);
    return Response.json([], { status: 500 });
  }
}
