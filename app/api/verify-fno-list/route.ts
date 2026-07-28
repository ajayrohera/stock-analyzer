// app/api/verify-fno-list/route.ts
//
// ONE-TIME USE: compares your current FNO_SYMBOLS dropdown list against
// Kite's OWN live NFO instrument list — the exact same data source
// /api/analyze already depends on for options chains. If a stock has
// instruments there, it's genuinely F&O-eligible, straight from the
// exchange via Kite — more authoritative than any third-party scraped
// "F&O stock list" article, and impossible to go stale the way a
// hardcoded array can.
//
// Protected by CRON_SECRET, same as the other maintenance routes.

import { NextRequest, NextResponse } from 'next/server';
import { KiteConnect } from 'kiteconnect';
import { createClient } from 'redis';

// Your current dropdown list (235 stocks, minus LTIM which was already removed)
const CURRENT_FNO_SYMBOLS = [
  '360ONE', 'ABB', 'ABCAPITAL', 'ADANIENSOL', 'ADANIENT', 'ADANIGREEN',
  'ADANIPORTS', 'ADANIPOWER', 'ALKEM', 'AMBER', 'AMBUJACEM', 'ANGELONE',
  'APLAPOLLO', 'APOLLOHOSP', 'ASHOKLEY', 'ASIANPAINT', 'ASTRAL', 'ATGL', 'AUBANK',
  'AUROPHARMA', 'AXISBANK', 'BAJAJ-AUTO', 'BAJAJFINSV', 'BAJAJHLDNG', 'BAJFINANCE',
  'BANDHANBNK', 'BANKBARODA', 'BANKINDIA', 'BDL', 'BEL', 'BHARATFORG', 'BHARTIARTL',
  'BHEL', 'BIOCON', 'BLUESTARCO', 'BOSCHLTD', 'BPCL', 'BRITANNIA', 'BSE', 'CAMS',
  'CANBK', 'CDSL', 'CGPOWER', 'CHOLAFIN', 'CIPLA', 'COALINDIA', 'COCHINSHIP',
  'COFORGE', 'COLPAL', 'CONCOR', 'COROMANDEL', 'CROMPTON', 'CUMMINSIND', 'CYIENT',
  'DABUR', 'DALBHARAT', 'DELHIVERY', 'DIVISLAB', 'DIXON', 'DLF', 'DMART', 'DRREDDY',
  'EICHERMOT', 'ENRIN', 'ETERNAL', 'EXIDEIND', 'FEDERALBNK', 'FORTIS', 'GAIL',
  'GLENMARK', 'GMRAIRPORT', 'GODFRYPHLP', 'GODREJCP', 'GODREJPROP', 'GRASIM',
  'GROWW', 'GVT&D', 'HAL', 'HAVELLS', 'HCLTECH', 'HDFCAMC', 'HDFCBANK', 'HDFCLIFE',
  'HEROMOTOCO', 'HFCL', 'HINDALCO', 'HINDPETRO', 'HINDUNILVR', 'HINDZINC', 'HUDCO',
  'HYUNDAI', 'ICICIAMC', 'ICICIBANK', 'ICICIGI', 'ICICIPRULI', 'IDEA', 'IDFCFIRSTB',
  'IEX', 'IGL', 'IIFL', 'INDHOTEL', 'INDIANB', 'INDIGO', 'INDUSINDBK', 'INDUSTOWER',
  'INFY', 'INOXWIND', 'IOC', 'IRCTC', 'IREDA', 'IRFC', 'ITC', 'JINDALSTEL', 'JIOFIN',
  'JSWENERGY', 'JSWSTEEL', 'JUBLFOOD', 'KALYANKJIL', 'KAYNES', 'KEI', 'KFINTECH',
  'KOTAKBANK', 'KPITTECH', 'LAURUSLABS', 'LENSKART', 'LGEINDIA', 'LICHSGFIN',
  'LICI', 'LODHA', 'LT', 'LTF', 'LUPIN', 'M&M', 'M&MFIN', 'MANAPPURAM', 'MANKIND',
  'MARICO', 'MARUTI', 'MAXHEALTH', 'MAZDOCK', 'MCX', 'MFSL', 'MOTHERSON',
  'MOTILALOFS', 'MPHASIS', 'MRF', 'MUTHOOTFIN', 'NATIONALUM', 'NAUKRI', 'NBCC',
  'NCC', 'NESTLEIND', 'NHPC', 'NMDC', 'NTPC', 'NUVAMA', 'NYKAA', 'OBEROIRLTY',
  'OFSS', 'OIL', 'ONGC', 'PAGEIND', 'PATANJALI', 'PAYTM', 'PERSISTENT', 'PETRONET',
  'PFC', 'PGEL', 'PHOENIXLTD', 'PIDILITIND', 'PIIND', 'PNB', 'PNBHOUSING',
  'POLICYBZR', 'POLYCAB', 'POWERGRID', 'POWERINDIA', 'PPLPHARMA', 'PREMIERENE',
  'PRESTIGE', 'RADICO', 'RBLBANK', 'RECLTD', 'RELIANCE', 'RVNL', 'SAIL',
  'SAMMAANCAP', 'SBICARD', 'SBIFUNDS', 'SBILIFE', 'SBIN', 'SHREECEM', 'SHRIRAMFIN',
  'SIEMENS', 'SOLARINDS', 'SONACOMS', 'SRF', 'SUNPHARMA', 'SUPREMEIND', 'SUZLON',
  'SWIGGY', 'SYNGENE', 'TATACAP', 'TATACOMM', 'TATACONSUM', 'TATAELXSI',
  'TATAINVEST', 'TATAPOWER', 'TATASTEEL', 'TATATECH', 'TCS', 'TECHM', 'TIINDIA',
  'TITAGARH', 'TITAN', 'TMCV', 'TMPV', 'TORNTPHARM', 'TORNTPOWER', 'TRENT',
  'TVSMOTOR', 'ULTRACEMCO', 'UNIONBANK', 'UNITDSPR', 'UNOMINDA', 'UPL', 'VBL',
  'VEDL', 'VMM', 'VOLTAS', 'WAAREEENER', 'WIPRO', 'YESBANK', 'ZYDUSLIFE'
];

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redisClient = createClient({ url: process.env.REDIS_URL });

  try {
    await redisClient.connect();

    const tokenDataStr = await redisClient.get('kite_token');
    if (!tokenDataStr) {
      return NextResponse.json({ error: 'No Kite token found in Redis. Refresh it first.' }, { status: 400 });
    }
    const tokenData = JSON.parse(tokenDataStr);

    const kc = new KiteConnect({ api_key: process.env.KITE_API_KEY! });
    kc.setAccessToken(tokenData.accessToken);

    // Fetch Kite's live NFO instrument list — this includes every stock
    // and index with listed futures/options contracts, straight from the
    // exchange via Kite's own data feed.
    const nfoInstruments = await kc.getInstruments('NFO');

    // Extract unique underlying stock names (the 'name' field), excluding
    // pure index instruments (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY etc.)
    // since those aren't individual stocks selectable in your dropdown.
    const indexNames = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'SENSEX', 'BANKEX']);
    const liveFnoStocks = new Set<string>();
    for (const inst of nfoInstruments) {
      if (inst && inst.name && !indexNames.has(inst.name.toUpperCase())) {
        liveFnoStocks.add(inst.name.toUpperCase());
      }
    }

    const currentSet = new Set(CURRENT_FNO_SYMBOLS.map(s => s.toUpperCase()));

    // In your dropdown but NOT genuinely F&O-eligible per Kite right now
    const shouldRemove = CURRENT_FNO_SYMBOLS.filter(s => !liveFnoStocks.has(s.toUpperCase()));

    // Genuinely F&O-eligible per Kite but missing from your dropdown
    const shouldAdd = Array.from(liveFnoStocks).filter(s => !currentSet.has(s)).sort();

    return NextResponse.json({
      success: true,
      totalLiveFnoStocks: liveFnoStocks.size,
      totalCurrentDropdownStocks: CURRENT_FNO_SYMBOLS.length,
      shouldRemove, // these are in your list but don't have real options right now
      shouldAdd,    // these have real options but aren't in your list yet
    });
  } catch (error: any) {
    console.error('❌ FNO list verification failed:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    await redisClient.quit();
  }
}
