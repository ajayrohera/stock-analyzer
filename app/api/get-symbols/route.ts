// /api/get-symbols/route.ts

export const runtime = 'nodejs';

let cachedSymbols: string[] | null = null;
let lastUpdated = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

async function fetchActiveFnOSymbols(): Promise<string[]> {
  const now = Date.now();

  // Serve from cache if fresh
  if (cachedSymbols && now - lastUpdated < CACHE_DURATION) {
    return cachedSymbols;
  }

  const response = await fetch('https://api.kite.trade/instruments', {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch instruments: ${response.status}`);
  }

  const csvText = await response.text();
  const lines = csvText.split('\n');

  const symbolsSet = new Set<string>();

  // Skip header row
  for (const line of lines.slice(1)) {
    if (!line) continue;

    const cols = line.split(',');

    /*
      Zerodha CSV columns (important ones):
      [2]  tradingsymbol
      [11] exchange
      [12] segment
    */
    const tradingsymbol = cols[2];
    const exchange = cols[11];
    const segment = cols[12];

    // Only NSE F&O OPTIONS
    if (exchange === 'NFO' && segment === 'NFO-OPT') {
      // Extract root symbol (e.g. RELIANCE from RELIANCE24JAN2500CE).
      const rootSymbol = tradingsymbol.replace(/\d.*$/, '');
      if (rootSymbol) {
        symbolsSet.add(rootSymbol);
      }
    }
  }

  const symbols = Array.from(symbolsSet).sort();

  // Update cache
  cachedSymbols = symbols;
  lastUpdated = now;

  return symbols;
}

export async function GET() {
  try {
    const symbols = await fetchActiveFnOSymbols();
    return Response.json(symbols);
  } catch (error) {
    console.error('❌ get-symbols API error:', error);
    return Response.json([], { status: 500 });
  }
}

