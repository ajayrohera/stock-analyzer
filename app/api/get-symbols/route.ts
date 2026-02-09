// app/api/get-symbols/route.ts

// Complete list of F&O stocks (as of recent NSE list)
const FNO_SYMBOLS = [
  'ACC', 'ADANIENT', 'ADANIPORTS', 'AMBUJACEM', 'APOLLOHOSP', 'APOLLOTYRE',
  'ASHOKLEY', 'ASIANPAINT', 'AUBANK', 'AUROPHARMA', 'AXISBANK', 'BAJAJ-AUTO',
  'BAJAJFINSV', 'BAJFINANCE', 'BALKRISIND', 'BANDHANBNK', 'BANKBARODA',
  'BANKINDIA', 'BATAINDIA', 'BEL', 'BERGEPAINT', 'BHARATFORG', 'BHARTIARTL',
  'BHEL', 'BIOCON', 'BPCL', 'BRITANNIA', 'CANBK', 'CANFINHOME', 'CHAMBLFERT',
  'CHOLAFIN', 'CIPLA', 'COALINDIA', 'COFORGE', 'COLPAL', 'CONCOR', 'COROMANDEL',
  'CROMPTON', 'CUB', 'CUMMINSIND', 'DABUR', 'DALBHARAT', 'DEEPAKNTR', 'DELTACORP',
  'DIVISLAB', 'DIXON', 'DLF', 'DMART', 'DRREDDY', 'EICHERMOT', 'ESCORTS',
  'EXIDEIND', 'FEDERALBNK', 'GAIL', 'GLENMARK', 'GMRINFRA', 'GNFC', 'GODREJCP',
  'GODREJPROP', 'GRANULES', 'GRASIM', 'GUJGASLTD', 'HAL', 'HAVELLS', 'HCLTECH',
  'HDFC', 'HDFCAMC', 'HDFCBANK', 'HDFCLIFE', 'HEROMOTOCO', 'HINDALCO',
  'HINDCOPPER', 'HINDPETRO', 'HINDUNILVR', 'HINDZINC', 'ICICIBANK', 'ICICIGI',
  'ICICIPRULI', 'IDEA', 'IDFC', 'IDFCFIRSTB', 'IEX', 'IGL', 'INDHOTEL',
  'INDIACEM', 'INDIGO', 'INDUSINDBK', 'INDUSTOWER', 'INFY', 'IOC', 'IPCALAB',
  'IRCTC', 'ITC', 'JINDALSTEL', 'JKCEMENT', 'JSWSTEEL', 'JUBLFOOD', 'KOTAKBANK',
  'L&TFH', 'LICHSGFIN', 'LT', 'LTIM', 'LTTS', 'LUPIN', 'M&M', 'M&MFIN',
  'MANAPPURAM', 'MARICO', 'MARUTI', 'MCDOWELL-N', 'MCX', 'METROPOLIS', 'MFSL',
  'MGL', 'MOTHERSON', 'MPHASIS', 'MRF', 'MUTHOOTFIN', 'NATIONALUM', 'NAUKRI',
  'NAVINFLUOR', 'NESTLEIND', 'NMDC', 'NTPC', 'OBEROIRLTY', 'OFSS', 'ONGC',
  'PAGEIND', 'PEL', 'PERSISTENT', 'PETRONET', 'PFC', 'PIDILITIND', 'PIIND',
  'PNB', 'POLYCAB', 'POWERGRID', 'PVRINOX', 'RAIN', 'RAMCOCEM', 'RBLBANK',
  'RECLTD', 'RELIANCE', 'SAIL', 'SBICARD', 'SBILIFE', 'SBIN', 'SHREECEM',
  'SHRIRAMFIN', 'SIEMENS', 'SRF', 'SUNPHARMA', 'SUNTV', 'SYNGENE', 'TATACHEM',
  'TATACOMM', 'TATACONSUM', 'TATAMOTORS', 'TATAPOWER', 'TATASTEEL', 'TATATECH',
  'TCS', 'TECHM', 'TITAN', 'TORNTPHARM', 'TRENT', 'TVSMOTOR', 'UBL', 'ULTRACEMCO',
  'UPL', 'VEDL', 'VOLTAS', 'WIPRO', 'YESBANK', 'ZEEL', 'ZYDUSLIFE'
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