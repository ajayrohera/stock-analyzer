// app/api/get-symbols/route.ts

// Verified F&O-only stock list (210 symbols)
// Verified 2026-07-28 directly against Kite's live NFO instrument
// data (see /api/verify-fno-list) — not a third-party scraped list.
// Removed: stocks recently delisted from F&O per NSE's periodic review
// (ATGL, COROMANDEL, CYIENT, ENRIN, GROWW, HFCL, HUDCO, ICICIAMC, IGL,
// IIFL, IRCTC, LENSKART, LGEINDIA, M&MFIN, MRF, NCC, PPLPHARMA, SAMMAANCAP,
// SBIFUNDS, SYNGENE, TATACAP, TATACOMM, TATAINVEST, TATATECH, TITAGARH,
// TMCV, TORNTPOWER)
// Fixed: LTIM -> LTM (Kite's actual instrument name for LTIMindtree)
// Added: FORCEMOT, NAM-INDIA (genuine F&O stocks previously missing)
const FNO_SYMBOLS = [
  '360ONE', 'ABB', 'ABCAPITAL', 'ADANIENSOL', 'ADANIENT', 'ADANIGREEN', 'ADANIPORTS', 
'ADANIPOWER', 'ALKEM', 'AMBER', 'AMBUJACEM', 'ANGELONE', 'APLAPOLLO', 'APOLLOHOSP', 
'ASHOKLEY', 'ASIANPAINT', 'ASTRAL', 'AUBANK', 'AUROPHARMA', 'AXISBANK', 'BAJAJ-AUTO', 
'BAJAJFINSV', 'BAJAJHLDNG', 'BAJFINANCE', 'BANDHANBNK', 'BANKBARODA', 'BANKINDIA', 'BDL', 
'BEL', 'BHARATFORG', 'BHARTIARTL', 'BHEL', 'BIOCON', 'BLUESTARCO', 'BOSCHLTD', 'BPCL', 
'BRITANNIA', 'BSE', 'CAMS', 'CANBK', 'CDSL', 'CGPOWER', 'CHOLAFIN', 'CIPLA', 'COALINDIA', 
'COCHINSHIP', 'COFORGE', 'COLPAL', 'CONCOR', 'CROMPTON', 'CUMMINSIND', 'DABUR', 'DALBHARAT', 
'DELHIVERY', 'DIVISLAB', 'DIXON', 'DLF', 'DMART', 'DRREDDY', 'EICHERMOT', 'ETERNAL', 
'EXIDEIND', 'FEDERALBNK', 'FORCEMOT', 'FORTIS', 'GAIL', 'GLENMARK', 'GMRAIRPORT', 
'GODFRYPHLP', 'GODREJCP', 'GODREJPROP', 'GRASIM', 'GVT&D', 'HAL', 'HAVELLS', 'HCLTECH', 
'HDFCAMC', 'HDFCBANK', 'HDFCLIFE', 'HEROMOTOCO', 'HINDALCO', 'HINDPETRO', 'HINDUNILVR', 
'HINDZINC', 'HYUNDAI', 'ICICIBANK', 'ICICIGI', 'ICICIPRULI', 'IDEA', 'IDFCFIRSTB', 'IEX', 
'INDHOTEL', 'INDIANB', 'INDIGO', 'INDUSINDBK', 'INDUSTOWER', 'INFY', 'INOXWIND', 'IOC', 
'IREDA', 'IRFC', 'ITC', 'JINDALSTEL', 'JIOFIN', 'JSWENERGY', 'JSWSTEEL', 'JUBLFOOD', 
'KALYANKJIL', 'KAYNES', 'KEI', 'KFINTECH', 'KOTAKBANK', 'KPITTECH', 'LAURUSLABS', 'LICHSGFIN', 
'LICI', 'LODHA', 'LT', 'LTF', 'LTM', 'LUPIN', 'M&M', 'MANAPPURAM', 'MANKIND', 'MARICO', 
'MARUTI', 'MAXHEALTH', 'MAZDOCK', 'MCX', 'MFSL', 'MOTHERSON', 'MOTILALOFS', 'MPHASIS', 
'MUTHOOTFIN', 'NAM-INDIA', 'NATIONALUM', 'NAUKRI', 'NBCC', 'NESTLEIND', 'NHPC', 'NMDC', 
'NTPC', 'NUVAMA', 'NYKAA', 'OBEROIRLTY', 'OFSS', 'OIL', 'ONGC', 'PAGEIND', 'PATANJALI', 
'PAYTM', 'PERSISTENT', 'PETRONET', 'PFC', 'PGEL', 'PHOENIXLTD', 'PIDILITIND', 'PIIND', 'PNB', 
'PNBHOUSING', 'POLICYBZR', 'POLYCAB', 'POWERGRID', 'POWERINDIA', 'PREMIERENE', 'PRESTIGE', 
'RADICO', 'RBLBANK', 'RECLTD', 'RELIANCE', 'RVNL', 'SAIL', 'SBICARD', 'SBILIFE', 'SBIN', 
'SHREECEM', 'SHRIRAMFIN', 'SIEMENS', 'SOLARINDS', 'SONACOMS', 'SRF', 'SUNPHARMA', 
'SUPREMEIND', 'SUZLON', 'SWIGGY', 'TATACONSUM', 'TATAELXSI', 'TATAPOWER', 'TATASTEEL', 'TCS', 
'TECHM', 'TIINDIA', 'TITAN', 'TMPV', 'TORNTPHARM', 'TRENT', 'TVSMOTOR', 'ULTRACEMCO', 
'UNIONBANK', 'UNITDSPR', 'UNOMINDA', 'UPL', 'VBL', 'VEDL', 'VMM', 'VOLTAS', 'WAAREEENER', 
'WIPRO', 'YESBANK', 'ZYDUSLIFE', 
].sort();

export async function GET() {
  try {
    // Return the static list
    return Response.json(FNO_SYMBOLS, {
      headers: {
        'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
      }
    });
  } catch (error) {
    console.error('Error:', error);
    // Still return the list even on error
    return Response.json(FNO_SYMBOLS);
  }
}

export const runtime = 'edge'; // Optional: Use edge runtime for faster response
export const dynamic = 'force-static'; // Mark as static
