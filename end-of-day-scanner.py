# save as eod_momentum_scanner_v2.py
# Run after 4:35 PM IST until next morning
# Requires: pip install yfinance pandas pytz numpy

import pandas as pd
import yfinance as yf
from datetime import datetime, time, timedelta
import pytz
import logging
import numpy as np

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

IST = pytz.timezone("Asia/Kolkata")

SYMBOLS = {
    "360ONE": "360ONE.NS",
    "ABB": "ABB.NS",
    "ABCAPITAL": "ABCAPITAL.NS",
    "ADANIENSOL": "ADANIENSOL.NS",
    "ADANIENT": "ADANIENT.NS",
    "ADANIGREEN": "ADANIGREEN.NS",
    "ADANIPORTS": "ADANIPORTS.NS",
    "ALKEM": "ALKEM.NS",
    "AMBER": "AMBER.NS",
    "AMBUJACEM": "AMBUJACEM.NS",
    "ANGELONE": "ANGELONE.NS",
    "APLAPOLLO": "APLAPOLLO.NS",
    "APOLLOHOSP": "APOLLOHOSP.NS",
    "ASHOKLEY": "ASHOKLEY.NS",
    "ASIANPAINT": "ASIANPAINT.NS",
    "ASTRAL": "ASTRAL.NS",
    "AUBANK": "AUBANK.NS",
    "AUROPHARMA": "AUROPHARMA.NS",
    "AXISBANK": "AXISBANK.NS",
    "BAJAJ-AUTO": "BAJAJ-AUTO.NS",
    "BAJAJFINSV": "BAJAJFINSV.NS",
    "BAJFINANCE": "BAJFINANCE.NS",
    "BANDHANBNK": "BANDHANBNK.NS",
    "BANKBARODA": "BANKBARODA.NS",
    "BANKINDIA": "BANKINDIA.NS",
    "BDL": "BDL.NS",
    "BEL": "BEL.NS",
    "BHARATFORG": "BHARATFORG.NS",
    "BHARTIARTL": "BHARTIARTL.NS",
    "BHEL": "BHEL.NS",
    "BIOCON": "BIOCON.NS",
    "BLUESTARCO": "BLUESTARCO.NS",
    "BOSCHLTD": "BOSCHLTD.NS",
    "BPCL": "BPCL.NS",
    "BRITANNIA": "BRITANNIA.NS",
    "BSE": "BSE.NS",
    "CAMS": "CAMS.NS",
    "CANBK": "CANBK.NS",
    "CDSL": "CDSL.NS",
    "CGPOWER": "CGPOWER.NS",
    "CHOLAFIN": "CHOLAFIN.NS",
    "CIPLA": "CIPLA.NS",
    "COALINDIA": "COALINDIA.NS",
    "COFORGE": "COFORGE.NS",
    "COLPAL": "COLPAL.NS",
    "CONCOR": "CONCOR.NS",
    "CROMPTON": "CROMPTON.NS",
    "CUMMINSIND": "CUMMINSIND.NS",
    "CYIENT": "CYIENT.NS",
    "DABUR": "DABUR.NS",
    "DALBHARAT": "DALBHARAT.NS",
    "DELHIVERY": "DELHIVERY.NS",
    "DIVISLAB": "DIVISLAB.NS",
    "DIXON": "DIXON.NS",
    "DLF": "DLF.NS",
    "DMART": "DMART.NS",
    "DRREDDY": "DRREDDY.NS",
    "EICHERMOT": "EICHERMOT.NS",
    "ETERNAL": "ETERNAL.NS",
    "EXIDEIND": "EXIDEIND.NS",
    "FEDERALBNK": "FEDERALBNK.NS",
    "FORTIS": "FORTIS.NS",
    "GAIL": "GAIL.NS",
    "GLENMARK": "GLENMARK.NS",
    "GMRAIRPORT": "GMRAIRPORT.NS",
    "GODREJCP": "GODREJCP.NS",
    "GODREJPROP": "GODREJPROP.NS",
    "GRASIM": "GRASIM.NS",
    "HAL": "HAL.NS",
    "HAVELLS": "HAVELLS.NS",
    "HCLTECH": "HCLTECH.NS",
    "HDFCAMC": "HDFCAMC.NS",
    "HDFCBANK": "HDFCBANK.NS",
    "HDFCLIFE": "HDFCLIFE.NS",
    "HEROMOTOCO": "HEROMOTOCO.NS",
    "HFCL": "HFCL.NS",
    "HINDALCO": "HINDALCO.NS",
    "HINDPETRO": "HINDPETRO.NS",
    "HINDUNILVR": "HINDUNILVR.NS",
    "HINDZINC": "HINDZINC.NS",
    "HUDCO": "HUDCO.NS",
    "ICICIBANK": "ICICIBANK.NS",
    "ICICIGI": "ICICIGI.NS",
    "ICICIPRULI": "ICICIPRULI.NS",
    "IDEA": "IDEA.NS",
    "IDFCFIRSTB": "IDFCFIRSTB.NS",
    "IEX": "IEX.NS",
    "IGL": "IGL.NS",
    "IIFL": "IIFL.NS",
    "INDHOTEL": "INDHOTEL.NS",
    "INDIANB": "INDIANB.NS",
    "INDIGO": "INDIGO.NS",
    "INDUSINDBK": "INDUSINDBK.NS",
    "INDUSTOWER": "INDUSTOWER.NS",
    "INFY": "INFY.NS",
    "INOXWIND": "INOXWIND.NS",
    "IOC": "IOC.NS",
    "IRCTC": "IRCTC.NS",
    "IREDA": "IREDA.NS",
    "IRFC": "IRFC.NS",
    "ITC": "ITC.NS",
    "JINDALSTEL": "JINDALSTEL.NS",
    "JIOFIN": "JIOFIN.NS",
    "JSWENERGY": "JSWENERGY.NS",
    "JSWSTEEL": "JSWSTEEL.NS",
    "JUBLFOOD": "JUBLFOOD.NS",
    "KALYANKJIL": "KALYANKJIL.NS",
    "KAYNES": "KAYNES.NS",
    "KEI": "KEI.NS",
    "KFINTECH": "KFINTECH.NS",
    "KOTAKBANK": "KOTAKBANK.NS",
    "KPITTECH": "KPITTECH.NS",
    "LAURUSLABS": "LAURUSLABS.NS",
    "LICHSGFIN": "LICHSGFIN.NS",
    "LICI": "LICI.NS",
    "LODHA": "LODHA.NS",
    "LT": "LT.NS",
    "LTF": "LTF.NS",
    "LTIM": "LTIM.NS",
    "LUPIN": "LUPIN.NS",
    "M&M": "M&M.NS",
    "MANAPPURAM": "MANAPPURAM.NS",
    "MANKIND": "MANKIND.NS",
    "MARICO": "MARICO.NS",
    "MARUTI": "MARUTi.NS",
    "MAXHEALTH": "MAXHEALTH.NS",
    "MAZDOCK": "MAZDOCK.NS",
    "MCX": "MCX.NS",
    "MFSL": "MFSL.NS",
    "MOTHERSON": "MOTHERSON.NS",
    "MPHASIS": "MPHASIS.NS",
    "MUTHOOTFIN": "MUTHOOTFIN.NS",
    "NATIONALUM": "NATIONALUM.NS",
    "NAUKRI": "NAUKRI.NS",
    "NBCC": "NBCC.NS",
    "NCC": "NCC.NS",
    "NESTLEIND": "NESTLEIND.NS",
    "NHPC": "NHPC.NS",
    "NMDC": "NMDC.NS",
    "NTPC": "NTPC.NS",
    "NUVAMA": "NUVAMA.NS",
    "NYKAA": "NYKAA.NS",
    "OBEROIRLTY": "OBEROIRLTY.NS",
    "OFSS": "OFSS.NS",
    "OIL": "OIL.NS",
    "ONGC": "ONGC.NS",
    "PAGEIND": "PAGEIND.NS",
    "PATANJALI": "PATANJALI.NS",
    "PAYTM": "PAYTM.NS",
    "PERSISTENT": "PERSISTENT.NS",
    "PETRONET": "PETRONET.NS",
    "PFC": "PFC.NS",
    "PGEL": "PGEL.NS",
    "PHOENIXLTD": "PHOENIXLTD.NS",
    "PIDILITIND": "PIDILITIND.NS",
    "PIIND": "PIIND.NS",
    "PNB": "PNB.NS",
    "PNBHOUSING": "PNBHOUSING.NS",
    "POLICYBZR": "POLICYBZR.NS",
    "POLYCAB": "POLYCAB.NS",
    "POWERGRID": "POWERGRID.NS",
    "POWERINDIA": "POWERINDIA.NS",
    "PPLPHARMA": "PPLPHARMA.NS",
    "PRESTIGE": "PRESTIGE.NS",
    "RBLBANK": "RBLBANK.NS",
    "RECLTD": "RECLTD.NS",
    "RELIANCE": "RELIANCE.NS",
    "RVNL": "RVNL.NS",
    "SAIL": "SAIL.NS",
    "SAMMAANCAP": "SAMMAANCAP.NS",
    "SBICARD": "SBICARD.NS",
    "SBILIFE": "SBILIFE.NS",
    "SBIN": "SBIN.NS",
    "SHREECEM": "SHREECEM.NS",
    "SHRIRAMFIN": "SHRIRAMFIN.NS",
    "SIEMENS": "SIEMENS.NS",
    "SOLARINDS": "SOLARINDS.NS",
    "SONACOMS": "SONACOMS.NS",
    "SRF": "SRF.NS",
    "SUNPHARMA": "SUNPHARMA.NS",
    "SUPREMEIND": "SUPREMEIND.NS",
    "SUZLON": "SUZLON.NS",
    "SYNGENE": "SYNGENE.NS",
    "TATACONSUM": "TATACONSUM.NS",
    "TATAELXSI": "TATAELXSI.NS",
    "TMPV": "TMPV.NS",
    "TATAPOWER": "TATAPOWER.NS",
    "TATASTEEL": "TATASTEEL.NS",
    "TATATECH": "TATATECH.NS",
    "TCS": "TCS.NS",
    "TECHM": "TECHM.NS",
    "TIINDIA": "TIINDIA.NS",
    "TITAGARH": "TITAGARH.NS",
    "TITAN": "TITAN.NS",
    "TORNTPHARM": "TORNTPHARM.NS",
    "TORNTPOWER": "TORNTPOWER.NS",
    "TRENT": "TRENT.NS",
    "TVSMOTOR": "TVSMOTOR.NS",
    "ULTRACEMCO": "ULTRACEMCO.NS",
    "UNIONBANK": "UNIONBANK.NS",
    "UNITDSPR": "UNITDSPR.NS",
    "UNOMINDA": "UNOMINDA.NS",
    "UPL": "UPL.NS",
    "VBL": "VBL.NS",
    "VEDL": "VEDL.NS",
    "VOLTAS": "VOLTAS.NS",
    "WIPRO": "WIPRO.NS",
    "YESBANK": "YESBANK.NS",
    "ZYDUSLIFE": "ZYDUSLIFE.NS"
}

def get_today_5m(symbol):
    """Get today's 5-minute data"""
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period="1d", interval="5m", auto_adjust=False, prepost=False)

        if df is None or df.empty:
            return None

        if df.index.tz is None:
            df.index = df.index.tz_localize('UTC').tz_convert(IST)
        else:
            df.index = df.index.tz_convert(IST)

        return df
    except Exception as e:
        logging.error("Error fetching data for %s: %s", symbol, e)
        return None

def check_liquidity(price, volume):
    """Check if candle has sufficient liquidity - EITHER turnover > ₹1 Cr OR shares > 50,000"""
    turnover = (price * volume) / 10000000  # Convert to ₹ Cr
    shares = volume
    
    # EITHER turnover > ₹1 Cr OR shares > 50,000
    return (turnover > 1.0) or (shares > 50000)

def analyze_last_two_candles(df):
    """Analyze the last two 5-minute candles with exact criteria"""
    if df is None or len(df) < 12:  # Need at least 12 candles for 10-period MA
        return None, "Insufficient data"
    
    # Get today's date
    today = datetime.now(IST).date()
    df_today = df[df.index.date == today]
    
    if len(df_today) < 12:
        return None, "Insufficient today's data"
    
    # Get last 12 candles (10 for MA + last 2)
    last_12 = df_today.tail(12)
    
    # Last two candles (4:25-4:30 and 4:30-4:35)
    candle1 = last_12.iloc[-2]  # Second last
    candle2 = last_12.iloc[-1]  # Last
    
    # Get OHLCV data for last two candles
    o1, h1, l1, c1, v1 = candle1['Open'], candle1['High'], candle1['Low'], candle1['Close'], candle1['Volume']
    o2, h2, l2, c2, v2 = candle2['Open'], candle2['High'], candle2['Low'], candle2['Close'], candle2['Volume']
    
    # Calculate 10-period volume MA (excluding last 2 candles)
    volume_ma_10 = last_12['Volume'].iloc[-12:-2].mean()
    
    # Calculate volume ratios
    v1_to_ma = v1 / volume_ma_10 if volume_ma_10 > 0 else 0
    v2_to_ma = v2 / volume_ma_10 if volume_ma_10 > 0 else 0
    v2_to_v1 = v2 / v1 if v1 > 0 else 0
    
    # Calculate turnover (₹ Cr)
    turnover1 = (c1 * v1) / 10000000  # Convert to ₹ Cr
    turnover2 = (c2 * v2) / 10000000  # Convert to ₹ Cr
    
    # Determine candle direction
    dir1 = "GREEN" if c1 > o1 else "RED" if c1 < o1 else "DOJI"
    dir2 = "GREEN" if c2 > o2 else "RED" if c2 < o2 else "DOJI"
    
    # --- VOLUME CRITERIA CHECKS ---
    vol_criteria_met = {
        "c1_above_ma": v1_to_ma > 1.2,                     # C1 > 1.2x MA
        "c2_above_ma": v2_to_ma > 1.2,                     # C2 > 1.2x MA
        "volume_accelerating": v2_to_v1 > 1.1,             # C2 > 1.1x C1
        "c1_liquidity": check_liquidity(c1, v1),           # C1 liquidity
        "c2_liquidity": check_liquidity(c2, v2),           # C2 liquidity
    }
    
    # All volume criteria must be met
    all_volume_criteria = all(vol_criteria_met.values())
    
    # --- PRICE PATTERN CHECKS ---
    # Calculate breakout thresholds
    bullish_breakout_level = h1 * 1.003  # 0.3% above C1 high
    bearish_breakout_level = l1 * 0.997  # 0.3% below C1 low
    
    # Check pattern conditions
    is_bullish_pattern = (dir1 == "GREEN" and dir2 == "GREEN" and c2 >= bullish_breakout_level)
    is_bearish_pattern = (dir1 == "RED" and dir2 == "RED" and c2 <= bearish_breakout_level)
    
    # Determine final pattern
    pattern = None
    if is_bullish_pattern:
        pattern = "DOUBLE_BULLISH"
        breakout_strength = ((c2 - h1) / h1) * 100  # How much above C1 high
    elif is_bearish_pattern:
        pattern = "DOUBLE_BEARISH"
        breakout_strength = ((l1 - c2) / l1) * 100  # How much below C1 low
    else:
        pattern = "NO_PATTERN"
        breakout_strength = 0
    
    # Calculate individual candle returns
    ret1 = ((c1 - o1) / o1) * 100
    ret2 = ((c2 - o2) / o2) * 100
    total_return = ret1 + ret2
    
    # Calculate C2 vs C1 relative position
    c2_vs_c1_pct = ((c2 - c1) / c1) * 100
    
    return {
        'candle1': {'o': o1, 'h': h1, 'l': l1, 'c': c1, 'v': v1, 'ret': ret1, 'dir': dir1,
                   'v_to_ma': v1_to_ma, 'turnover': turnover1},
        'candle2': {'o': o2, 'h': h2, 'l': l2, 'c': c2, 'v': v2, 'ret': ret2, 'dir': dir2,
                   'v_to_ma': v2_to_ma, 'turnover': turnover2},
        'volume_ma_10': volume_ma_10,
        'v2_to_v1': v2_to_v1,
        'pattern': pattern,
        'vol_criteria': vol_criteria_met,
        'all_volume_criteria': all_volume_criteria,
        'is_bullish': is_bullish_pattern,
        'is_bearish': is_bearish_pattern,
        'breakout_level': bullish_breakout_level if is_bullish_pattern else bearish_breakout_level,
        'breakout_strength': breakout_strength,
        'total_return': total_return,
        'c2_vs_c1_pct': c2_vs_c1_pct,
        'final_price': c2,
        'c1_high': h1,
        'c1_low': l1
    }, None

if __name__ == "__main__":
    current_time = datetime.now(IST)
    print(f"\n{'='*80}")
    print(f"📊 END-OF-DAY MOMENTUM SCANNER V2 (STRICT CRITERIA)")
    print(f"⏰ Run Time: {current_time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"📈 Scanning {len(SYMBOLS)} F&O Stocks")
    print(f"{'='*80}\n")
    
    # Categories for classification
    strong_bullish = []
    strong_bearish = []
    weak_pattern_only = []
    insufficient_data = []
    
    # Progress tracking
    total_stocks = len(SYMBOLS)
    processed = 0
    
    for name, symbol in SYMBOLS.items():
        processed += 1
        print(f"Processing: {name} ({processed}/{total_stocks})", end="\r")
        
        df = get_today_5m(symbol)
        
        if df is None or len(df) < 12:
            insufficient_data.append((name, "No data or insufficient candles"))
            continue
        
        analysis, error = analyze_last_two_candles(df)
        
        if error:
            insufficient_data.append((name, error))
            continue
        
        # Classify based on pattern AND volume criteria
        if analysis['pattern'] in ["DOUBLE_BULLISH", "DOUBLE_BEARISH"]:
            if analysis['all_volume_criteria']:
                if analysis['pattern'] == "DOUBLE_BULLISH":
                    strong_bullish.append((name, analysis))
                else:
                    strong_bearish.append((name, analysis))
            else:
                weak_pattern_only.append((name, analysis))
    
    print("\n" + "="*80)
    
    # Display Results
    
    # 1. STRONG BULLISH (Pattern + ALL Volume Criteria Met)
    print("\n🎯 STRONG BULLISH CLOSE (ALL CRITERIA MET)")
    print("="*80)
    if strong_bullish:
        # Sort by breakout strength (highest first)
        strong_bullish.sort(key=lambda x: x[1]['breakout_strength'], reverse=True)
        
        for name, analysis in strong_bullish:
            c1 = analysis['candle1']
            c2 = analysis['candle2']
            vol_crit = analysis['vol_criteria']
            
            print(f"\n🟢 {name}")
            print(f"   Price: ₹{analysis['final_price']:.2f} | Above C1 High: +{analysis['breakout_strength']:.2f}%")
            print(f"   C1 (4:25): {c1['dir']} {c1['ret']:+.2f}% | High: ₹{analysis['c1_high']:.2f}")
            print(f"   C2 (4:30): {c2['dir']} {c2['ret']:+.2f}% | Close: ₹{c2['c']:.2f}")
            print(f"   Volume: C1={c1['v_to_ma']:.2f}x MA | C2={c2['v_to_ma']:.2f}x MA | C2/C1={analysis['v2_to_v1']:.2f}x")
            print(f"   Turnover: C1=₹{c1['turnover']:.2f} Cr | C2=₹{c2['turnover']:.2f} Cr")
            print(f"   Volume Criteria: {'✅' if vol_crit['c1_above_ma'] else '❌'} C1>1.2xMA | "
                  f"{'✅' if vol_crit['c2_above_ma'] else '❌'} C2>1.2xMA | "
                  f"{'✅' if vol_crit['volume_accelerating'] else '❌'} C2>1.2xC1")
            print(f"   Liquidity: {'✅' if vol_crit['c1_liquidity'] else '❌'} C1 | "
                  f"{'✅' if vol_crit['c2_liquidity'] else '❌'} C2")
    else:
        print("No strong bullish candidates found")
    
    # 2. STRONG BEARISH (Pattern + ALL Volume Criteria Met)
    print("\n\n🎯 STRONG BEARISH CLOSE (ALL CRITERIA MET)")
    print("="*80)
    if strong_bearish:
        # Sort by breakout strength (highest first)
        strong_bearish.sort(key=lambda x: x[1]['breakout_strength'], reverse=True)
        
        for name, analysis in strong_bearish:
            c1 = analysis['candle1']
            c2 = analysis['candle2']
            vol_crit = analysis['vol_criteria']
            
            print(f"\n🔴 {name}")
            print(f"   Price: ₹{analysis['final_price']:.2f} | Below C1 Low: +{analysis['breakout_strength']:.2f}%")
            print(f"   C1 (4:25): {c1['dir']} {c1['ret']:+.2f}% | Low: ₹{analysis['c1_low']:.2f}")
            print(f"   C2 (4:30): {c2['dir']} {c2['ret']:+.2f}% | Close: ₹{c2['c']:.2f}")
            print(f"   Volume: C1={c1['v_to_ma']:.2f}x MA | C2={c2['v_to_ma']:.2f}x MA | C2/C1={analysis['v2_to_v1']:.2f}x")
            print(f"   Turnover: C1=₹{c1['turnover']:.2f} Cr | C2=₹{c2['turnover']:.2f} Cr")
            print(f"   Volume Criteria: {'✅' if vol_crit['c1_above_ma'] else '❌'} C1>1.2xMA | "
                  f"{'✅' if vol_crit['c2_above_ma'] else '❌'} C2>1.2xMA | "
                  f"{'✅' if vol_crit['volume_accelerating'] else '❌'} C2>1.2xC1")
            print(f"   Liquidity: {'✅' if vol_crit['c1_liquidity'] else '❌'} C1 | "
                  f"{'✅' if vol_crit['c2_liquidity'] else '❌'} C2")
    else:
        print("No strong bearish candidates found")
    
    # 3. WEAK PATTERNS (Pattern but NOT all Volume Criteria)
    print("\n\n⚠️  WEAK PATTERNS (Missing Volume Criteria)")
    print("="*80)
    if weak_pattern_only:
        # Separate bullish and bearish
        weak_bullish = [w for w in weak_pattern_only if w[1]['pattern'] == "DOUBLE_BULLISH"]
        weak_bearish = [w for w in weak_pattern_only if w[1]['pattern'] == "DOUBLE_BEARISH"]
        
        if weak_bullish:
            weak_bullish.sort(key=lambda x: x[1]['breakout_strength'], reverse=True)
            print("\n🟢 WEAK BULLISH:")
            for name, analysis in weak_bullish[:5]:
                c1 = analysis['candle1']
                c2 = analysis['candle2']
                vol_crit = analysis['vol_criteria']
                
                print(f"\n  {name}")
                print(f"    Breakout: +{analysis['breakout_strength']:.2f}% above C1 high")
                print(f"    Volume: C1={c1['v_to_ma']:.2f}x MA | C2={c2['v_to_ma']:.2f}x MA")
                print(f"    Failed Criteria: ", end="")
                failed = [k for k, v in vol_crit.items() if not v]
                print(", ".join(failed) if failed else "None")
        
        if weak_bearish:
            weak_bearish.sort(key=lambda x: x[1]['breakout_strength'], reverse=True)
            print("\n🔴 WEAK BEARISH:")
            for name, analysis in weak_bearish[:5]:
                c1 = analysis['candle1']
                c2 = analysis['candle2']
                vol_crit = analysis['vol_criteria']
                
                print(f"\n  {name}")
                print(f"    Breakdown: +{analysis['breakout_strength']:.2f}% below C1 low")
                print(f"    Volume: C1={c1['v_to_ma']:.2f}x MA | C2={c2['v_to_ma']:.2f}x MA")
                print(f"    Failed Criteria: ", end="")
                failed = [k for k, v in vol_crit.items() if not v]
                print(", ".join(failed) if failed else "None")
        
        if len(weak_pattern_only) > 10:
            print(f"\n... and {len(weak_pattern_only) - 10} more weak patterns")
    else:
        print("No weak patterns found")
    
    # 4. INSUFFICIENT DATA
    print("\n\n❓ INSUFFICIENT DATA")
    print("="*80)
    if insufficient_data:
        print(f"Total: {len(insufficient_data)} stocks")
        for name, reason in insufficient_data[:10]:
            print(f"  {name}: {reason}")
        
        if len(insufficient_data) > 10:
            print(f"... and {len(insufficient_data) - 10} more")
    else:
        print("All stocks processed successfully!")
    
    # SUMMARY STATISTICS
    print("\n" + "="*80)
    print("📈 SUMMARY STATISTICS")
    print("="*80)
    print(f"Total Stocks Scanned: {total_stocks}")
    print(f"Strong Bullish (ALL criteria): {len(strong_bullish)}")
    print(f"Strong Bearish (ALL criteria): {len(strong_bearish)}")
    print(f"Weak Patterns (pattern only): {len(weak_pattern_only)}")
    print(f"Insufficient Data: {len(insufficient_data)}")
    
    # TRADING RECOMMENDATIONS
    print("\n" + "="*80)
    print("💡 PRE-MARKET TRADING PREPARATION")
    print("="*80)
    
    print("\n🎯 TOP PRIORITY TRADES (ALL CRITERIA MET):")
    
    if strong_bullish:
        print("\n  🟢 BULLISH (Consider long/avoid short):")
        for name, analysis in strong_bullish[:3]:
            print(f"    • {name}: Close ₹{analysis['final_price']:.2f}, "
                  f"+{analysis['breakout_strength']:.2f}% above C1 high")
    
    if strong_bearish:
        print("\n  🔴 BEARISH (Consider short/avoid long):")
        for name, analysis in strong_bearish[:3]:
            print(f"    • {name}: Close ₹{analysis['final_price']:.2f}, "
                  f"+{analysis['breakout_strength']:.2f}% below C1 low")
    
    print("\n⚠️  WATCHLIST (Needs confirmation next day):")
    if weak_pattern_only:
        weak_bullish = [w for w in weak_pattern_only if w[1]['pattern'] == "DOUBLE_BULLISH"]
        weak_bearish = [w for w in weak_pattern_only if w[1]['pattern'] == "DOUBLE_BEARISH"]
        
        if weak_bullish:
            print("  🟢 Potential Bullish if volume confirms:")
            for name, analysis in weak_bullish[:2]:
                print(f"    • {name}: +{analysis['breakout_strength']:.2f}% above C1 high")
        
        if weak_bearish:
            print("  🔴 Potential Bearish if volume confirms:")
            for name, analysis in weak_bearish[:2]:
                print(f"    • {name}: +{analysis['breakout_strength']:.2f}% below C1 low")
    
    print(f"\n⏰ Next Market Open: Tomorrow 9:15 AM IST")
    print(f"📊 Scanner Criteria:")
    print(f"  1. Both candles same color (G/G or R/R)")
    print(f"  2. C2 closes ≥0.3% above C1 high (bullish) or ≤0.3% below C1 low (bearish)")
    print(f"  3. C1 & C2 volume > 1.2x 10-period MA")
    print(f"  4. C2 volume > 1.1x C1 volume")
    print(f"  5. Liquidity: Turnover > ₹1 Cr OR Shares > 50,000 (both candles)")
    print(f"{'='*80}")