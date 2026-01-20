# save as eod_momentum_scanner_v3.py
# Run after 4:35 PM IST until next morning
# Requires: pip install yfinance pandas pytz numpy

import pandas as pd
import yfinance as yf
from datetime import datetime, time, timedelta
import pytz
import logging
import numpy as np
from collections import defaultdict

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
    "BAJAJHLDNG": "BAJAJHLDNG.NS",
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
    "PREMIERENE": "PREMIERENE.NS",
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
    "SWIGGY": "SWIGGY.NS",
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
    "WAAREEENER": "WAAREEENER.NS",
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

def get_daily_data(symbol, days=100):
    """Get daily data for EMA calculation and analysis"""
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=f"{days}d", interval="1d", auto_adjust=False, prepost=False)
        
        if df is None or df.empty:
            return None
            
        return df
    except Exception as e:
        logging.error("Error fetching daily data for %s: %s", symbol, e)
        return None

def calculate_emas_and_analysis(daily_df, current_price):
    """Calculate EMAs and perform daily analysis"""
    if daily_df is None or len(daily_df) < 100:
        return None
    
    # Calculate EMAs
    ema20 = daily_df['Close'].ewm(span=20, adjust=False).mean().iloc[-1]
    ema50 = daily_df['Close'].ewm(span=50, adjust=False).mean().iloc[-1]
    ema100 = daily_df['Close'].ewm(span=100, adjust=False).mean().iloc[-1]
    
    # Calculate distances
    dist_to_20 = ((current_price - ema20) / ema20) * 100
    dist_to_50 = ((current_price - ema50) / ema50) * 100
    dist_to_100 = ((current_price - ema100) / ema100) * 100
    
    # Determine EMA alignment (bullish if 20>50>100)
    ema_alignment = "BULLISH" if ema20 > ema50 and ema50 > ema100 else "BEARISH" if ema20 < ema50 and ema50 < ema100 else "MIXED"
    
    # Count how many EMAs price is above
    above_ema_count = sum([dist_to_20 > 0, dist_to_50 > 0, dist_to_100 > 0])
    
    # Get today's daily candle
    today_candle = daily_df.iloc[-1]
    prev_candle = daily_df.iloc[-2] if len(daily_df) > 1 else None
    
    # Determine daily candle pattern
    daily_pattern = "NEUTRAL"
    if prev_candle is not None:
        o_today, h_today, l_today, c_today = today_candle['Open'], today_candle['High'], today_candle['Low'], today_candle['Close']
        o_prev, h_prev, l_prev, c_prev = prev_candle['Open'], prev_candle['High'], prev_candle['Low'], prev_candle['Close']
        
        # Bullish engulfing
        if c_today > o_today and c_prev < o_prev and o_today < c_prev and c_today > o_prev:
            daily_pattern = "BULLISH_ENGULFING"
        # Bearish engulfing
        elif c_today < o_today and c_prev > o_prev and o_today > c_prev and c_today < o_prev:
            daily_pattern = "BEARISH_ENGULFING"
        # Inside bar
        elif h_today <= h_prev and l_today >= l_prev:
            daily_pattern = "INSIDE_BAR"
        # Outside bar
        elif h_today > h_prev and l_today < l_prev:
            daily_pattern = "OUTSIDE_BAR"
        # Strong close (top/bottom 20% of range)
        elif (c_today - l_today) / (h_today - l_today) > 0.8:
            daily_pattern = "STRONG_CLOSE_HIGH"
        elif (c_today - l_today) / (h_today - l_today) < 0.2:
            daily_pattern = "WEAK_CLOSE_LOW"
    
    # Volume analysis (simplified - yfinance doesn't provide delivery data)
    avg_volume_20 = daily_df['Volume'].tail(20).mean()
    today_volume = today_candle['Volume']
    volume_ratio = today_volume / avg_volume_20 if avg_volume_20 > 0 else 1
    
    return {
        'ema20': ema20,
        'ema50': ema50,
        'ema100': ema100,
        'dist_to_20': dist_to_20,
        'dist_to_50': dist_to_50,
        'dist_to_100': dist_to_100,
        'ema_alignment': ema_alignment,
        'above_ema_count': above_ema_count,
        'daily_pattern': daily_pattern,
        'today_high': today_candle['High'],
        'today_low': today_candle['Low'],
        'today_close': today_candle['Close'],
        'today_volume': today_volume,
        'volume_ratio': volume_ratio,
        'daily_return': ((today_candle['Close'] - today_candle['Open']) / today_candle['Open']) * 100
    }

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

def calculate_composite_score(analysis, ema_analysis):
    """Calculate a composite score from 0-100 for trade confidence"""
    score = 0
    max_score = 100
    
    # Pattern strength (40 points)
    if analysis['pattern'] in ["DOUBLE_BULLISH", "DOUBLE_BEARISH"]:
        score += 20
        
        # Breakout strength (up to 20 points)
        breakout_str = min(analysis['breakout_strength'], 2.0)  # Cap at 2%
        score += (breakout_str / 2.0) * 20
    
    # Volume criteria (30 points)
    if analysis['all_volume_criteria']:
        score += 30
    else:
        # Partial credit for volume
        vol_met = sum(analysis['vol_criteria'].values())
        score += (vol_met / 5) * 30
    
    # EMA analysis (30 points)
    if ema_analysis:
        # Count of EMAs price is above (for bullish) or below (for bearish)
        if analysis['pattern'] == "DOUBLE_BULLISH":
            ema_score = (ema_analysis['above_ema_count'] / 3) * 15
        else:  # BEARISH
            ema_score = ((3 - ema_analysis['above_ema_count']) / 3) * 15
        
        # EMA alignment (15 points)
        if (analysis['pattern'] == "DOUBLE_BULLISH" and ema_analysis['ema_alignment'] == "BULLISH") or \
           (analysis['pattern'] == "DOUBLE_BEARISH" and ema_analysis['ema_alignment'] == "BEARISH"):
            ema_score += 15
        
        score += ema_score
    
    return min(score, 100)

if __name__ == "__main__":
    current_time = datetime.now(IST)
    print(f"\n{'='*100}")
    print(f"📊 END-OF-DAY MOMENTUM SCANNER V3 (ENHANCED WITH EMA & DAILY ANALYSIS)")
    print(f"⏰ Run Time: {current_time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"📈 Scanning {len(SYMBOLS)} F&O Stocks")
    print(f"{'='*100}\n")
    
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
        
        # Get 5-minute data for pattern analysis
        df_5m = get_today_5m(symbol)
        
        if df_5m is None or len(df_5m) < 12:
            insufficient_data.append((name, "No 5-min data or insufficient candles"))
            continue
        
        # Analyze last two candles
        analysis, error = analyze_last_two_candles(df_5m)
        
        if error:
            insufficient_data.append((name, error))
            continue
        
        # Get daily data for EMA analysis
        daily_df = get_daily_data(symbol)
        ema_analysis = None
        if daily_df is not None and len(daily_df) >= 20:
            ema_analysis = calculate_emas_and_analysis(daily_df, analysis['final_price'])
        
        # Add EMA analysis to results
        analysis['ema_analysis'] = ema_analysis
        
        # Calculate composite score
        composite_score = calculate_composite_score(analysis, ema_analysis)
        analysis['composite_score'] = composite_score
        
        # Classify based on pattern AND volume criteria
        if analysis['pattern'] in ["DOUBLE_BULLISH", "DOUBLE_BEARISH"]:
            if analysis['all_volume_criteria']:
                if analysis['pattern'] == "DOUBLE_BULLISH":
                    strong_bullish.append((name, analysis))
                else:
                    strong_bearish.append((name, analysis))
            else:
                weak_pattern_only.append((name, analysis))
    
    print("\n" + "="*100)
    
    # Display Results
    
    # 1. STRONG BULLISH (Pattern + ALL Volume Criteria Met)
    print("\n🎯 STRONG BULLISH CLOSE (ALL CRITERIA MET)")
    print("="*100)
    if strong_bullish:
        # Sort by composite score (highest first)
        strong_bullish.sort(key=lambda x: x[1]['composite_score'], reverse=True)
        
        for name, analysis in strong_bullish:
            c1 = analysis['candle1']
            c2 = analysis['candle2']
            vol_crit = analysis['vol_criteria']
            ema = analysis['ema_analysis']
            
            print(f"\n{'='*80}")
            print(f"🟢 {name} (Score: {analysis['composite_score']:.0f}/100)")
            print(f"{'='*80}")
            
            print(f"🎯 PATTERN CONFIRMED")
            print(f"  • Double Green Close: ✅ Both 4:25 & 4:30 candles green")
            print(f"  • Breakout Strength: +{analysis['breakout_strength']:.2f}% above C1 high")
            print(f"  • Volume Acceleration: C2 volume {analysis['v2_to_v1']:.1f}x C1")
            
            if ema:
                print(f"\n📊 TECHNICAL POSITION (DAILY CHART)")
                print(f"  • Close: ₹{analysis['final_price']:.2f}")
                print(f"  • Position vs EMAs:")
                print(f"     → 20 EMA: ₹{ema['ema20']:.2f} ({'+' if ema['dist_to_20'] > 0 else ''}{ema['dist_to_20']:.1f}%)")
                print(f"     → 50 EMA: ₹{ema['ema50']:.2f} ({'+' if ema['dist_to_50'] > 0 else ''}{ema['dist_to_50']:.1f}%)")
                print(f"     → 100 EMA: ₹{ema['ema100']:.2f} ({'+' if ema['dist_to_100'] > 0 else ''}{ema['dist_to_100']:.1f}%)")
                print(f"  • EMA Alignment: {ema['ema_alignment']} ({ema['above_ema_count']}/3 above)")
                print(f"  • Daily Pattern: {ema['daily_pattern'].replace('_', ' ').title()}")
                print(f"  • Day's Range: ₹{ema['today_low']:.2f} - ₹{ema['today_high']:.2f}")
                print(f"  • Volume: {ema['volume_ratio']:.1f}x 20-day avg")
            
            print(f"\n📈 VOLUME ANALYSIS (5-min)")
            print(f"  • C1 (4:25): {c1['v_to_ma']:.1f}x MA | Turnover: ₹{c1['turnover']:.2f} Cr")
            print(f"  • C2 (4:30): {c2['v_to_ma']:.1f}x MA | Turnover: ₹{c2['turnover']:.2f} Cr")
            print(f"  • Volume Criteria: ", end="")
            for crit_name, crit_met in vol_crit.items():
                icon = "✅" if crit_met else "❌"
                print(f"{icon}", end=" ")
            print()
            
            # Trading implications
            print(f"\n🎯 TRADING IMPLICATIONS")
            if ema:
                if ema['above_ema_count'] == 3:
                    print(f"  • Priority: HIGH (Perfect bullish alignment)")
                elif ema['above_ema_count'] == 2:
                    print(f"  • Priority: MEDIUM-HIGH (Strong bullish)")
                else:
                    print(f"  • Priority: MEDIUM (Needs confirmation)")
                
                # Simple target calculation
                if ema['dist_to_20'] > 0:
                    target_pct = min(ema['dist_to_20'] * 1.5, 5.0)  # Up to 1.5x distance to 20EMA or 5%
                    stop_pct = max(ema['dist_to_20'] * 0.5, 1.5)    # 0.5x distance or 1.5% min
                else:
                    target_pct = 2.0
                    stop_pct = 1.5
                
                target_price = analysis['final_price'] * (1 + target_pct/100)
                stop_price = analysis['final_price'] * (1 - stop_pct/100)
                
                print(f"  • Next Target: ₹{target_price:.2f} (+{target_pct:.1f}%)")
                print(f"  • Stop Loss: ₹{stop_price:.2f} (-{stop_pct:.1f}%)")
                print(f"  • Risk/Reward: 1:{target_pct/stop_pct:.1f}")
            else:
                print(f"  • Priority: MEDIUM (No EMA data)")
                print(f"  • Next Target: ₹{analysis['final_price'] * 1.02:.2f} (+2.0%)")
                print(f"  • Stop Loss: ₹{analysis['final_price'] * 0.985:.2f} (-1.5%)")
                print(f"  • Risk/Reward: 1:1.3")
    else:
        print("No strong bullish candidates found")
    
    # 2. STRONG BEARISH (Pattern + ALL Volume Criteria Met)
    print(f"\n\n{'-'*100}")
    print("\n🎯 STRONG BEARISH CLOSE (ALL CRITERIA MET)")
    print("="*100)
    if strong_bearish:
        # Sort by composite score (highest first)
        strong_bearish.sort(key=lambda x: x[1]['composite_score'], reverse=True)
        
        for name, analysis in strong_bearish:
            c1 = analysis['candle1']
            c2 = analysis['candle2']
            vol_crit = analysis['vol_criteria']
            ema = analysis['ema_analysis']
            
            print(f"\n{'='*80}")
            print(f"🔴 {name} (Score: {analysis['composite_score']:.0f}/100)")
            print(f"{'='*80}")
            
            print(f"🎯 PATTERN CONFIRMED")
            print(f"  • Double Red Close: ✅ Both 4:25 & 4:30 candles red")
            print(f"  • Breakdown Strength: +{analysis['breakout_strength']:.2f}% below C1 low")
            print(f"  • Volume Acceleration: C2 volume {analysis['v2_to_v1']:.1f}x C1")
            
            if ema:
                print(f"\n📊 TECHNICAL POSITION (DAILY CHART)")
                print(f"  • Close: ₹{analysis['final_price']:.2f}")
                print(f"  • Position vs EMAs:")
                print(f"     → 20 EMA: ₹{ema['ema20']:.2f} ({'+' if ema['dist_to_20'] > 0 else ''}{ema['dist_to_20']:.1f}%)")
                print(f"     → 50 EMA: ₹{ema['ema50']:.2f} ({'+' if ema['dist_to_50'] > 0 else ''}{ema['dist_to_50']:.1f}%)")
                print(f"     → 100 EMA: ₹{ema['ema100']:.2f} ({'+' if ema['dist_to_100'] > 0 else ''}{ema['dist_to_100']:.1f}%)")
                print(f"  • EMA Alignment: {ema['ema_alignment']} ({3 - ema['above_ema_count']}/3 below)")
                print(f"  • Daily Pattern: {ema['daily_pattern'].replace('_', ' ').title()}")
                print(f"  • Day's Range: ₹{ema['today_low']:.2f} - ₹{ema['today_high']:.2f}")
                print(f"  • Volume: {ema['volume_ratio']:.1f}x 20-day avg")
            
            print(f"\n📈 VOLUME ANALYSIS (5-min)")
            print(f"  • C1 (4:25): {c1['v_to_ma']:.1f}x MA | Turnover: ₹{c1['turnover']:.2f} Cr")
            print(f"  • C2 (4:30): {c2['v_to_ma']:.1f}x MA | Turnover: ₹{c2['turnover']:.2f} Cr")
            print(f"  • Volume Criteria: ", end="")
            for crit_name, crit_met in vol_crit.items():
                icon = "✅" if crit_met else "❌"
                print(f"{icon}", end=" ")
            print()
            
            # Trading implications
            print(f"\n🎯 TRADING IMPLICATIONS")
            if ema:
                if ema['above_ema_count'] == 0:
                    print(f"  • Priority: HIGH (Perfect bearish alignment)")
                elif ema['above_ema_count'] == 1:
                    print(f"  • Priority: MEDIUM-HIGH (Strong bearish)")
                else:
                    print(f"  • Priority: MEDIUM (Needs confirmation)")
                
                # Simple target calculation for bearish
                if ema['dist_to_20'] < 0:
                    target_pct = min(abs(ema['dist_to_20']) * 1.5, 5.0)  # Down to 1.5x distance or 5%
                    stop_pct = max(abs(ema['dist_to_20']) * 0.5, 1.5)    # 0.5x distance or 1.5% min
                else:
                    target_pct = 2.0
                    stop_pct = 1.5
                
                target_price = analysis['final_price'] * (1 - target_pct/100)
                stop_price = analysis['final_price'] * (1 + stop_pct/100)
                
                print(f"  • Next Target: ₹{target_price:.2f} (-{target_pct:.1f}%)")
                print(f"  • Stop Loss: ₹{stop_price:.2f} (+{stop_pct:.1f}%)")
                print(f"  • Risk/Reward: 1:{target_pct/stop_pct:.1f}")
            else:
                print(f"  • Priority: MEDIUM (No EMA data)")
                print(f"  • Next Target: ₹{analysis['final_price'] * 0.98:.2f} (-2.0%)")
                print(f"  • Stop Loss: ₹{analysis['final_price'] * 1.015:.2f} (+1.5%)")
                print(f"  • Risk/Reward: 1:1.3")
    else:
        print("No strong bearish candidates found")
    
    # 3. WEAK PATTERNS (Pattern but NOT all Volume Criteria)
    print(f"\n\n{'-'*100}")
    print("\n⚠️  WEAK PATTERNS (Missing Volume Criteria)")
    print("="*100)
    if weak_pattern_only:
        # Separate bullish and bearish
        weak_bullish = [w for w in weak_pattern_only if w[1]['pattern'] == "DOUBLE_BULLISH"]
        weak_bearish = [w for w in weak_pattern_only if w[1]['pattern'] == "DOUBLE_BEARISH"]
        
        print(f"\nTotal Weak Patterns: {len(weak_pattern_only)} ({len(weak_bullish)} bullish, {len(weak_bearish)} bearish)")
        
        if weak_bullish:
            weak_bullish.sort(key=lambda x: x[1]['composite_score'], reverse=True)
            print(f"\n🟢 TOP 5 WEAK BULLISH (by score):")
            for name, analysis in weak_bullish[:5]:
                failed_criteria = [k for k, v in analysis['vol_criteria'].items() if not v]
                ema = analysis['ema_analysis']
                ema_info = ""
                if ema:
                    ema_info = f" | Above {ema['above_ema_count']}/3 EMAs"
                print(f"  • {name} ({analysis['composite_score']:.0f}/100): Failed: {', '.join(failed_criteria)}{ema_info}")
        
        if weak_bearish:
            weak_bearish.sort(key=lambda x: x[1]['composite_score'], reverse=True)
            print(f"\n🔴 TOP 5 WEAK BEARISH (by score):")
            for name, analysis in weak_bearish[:5]:
                failed_criteria = [k for k, v in analysis['vol_criteria'].items() if not v]
                ema = analysis['ema_analysis']
                ema_info = ""
                if ema:
                    ema_info = f" | Below {3 - ema['above_ema_count']}/3 EMAs"
                print(f"  • {name} ({analysis['composite_score']:.0f}/100): Failed: {', '.join(failed_criteria)}{ema_info}")
        
        if len(weak_pattern_only) > 10:
            print(f"\n... and {len(weak_pattern_only) - 10} more weak patterns")
    else:
        print("No weak patterns found")
    
    # 4. SUMMARY STATISTICS
    print(f"\n\n{'-'*100}")
    print("\n📈 SUMMARY STATISTICS")
    print("="*100)
    print(f"Total Stocks Scanned: {total_stocks}")
    print(f"Strong Bullish (ALL criteria): {len(strong_bullish)}")
    print(f"Strong Bearish (ALL criteria): {len(strong_bearish)}")
    print(f"Weak Patterns (pattern only): {len(weak_pattern_only)}")
    print(f"Insufficient Data: {len(insufficient_data)}")
    
    # Score distribution
    if strong_bullish or strong_bearish:
        print(f"\n📊 SCORE DISTRIBUTION:")
        all_strong = strong_bullish + strong_bearish
        score_ranges = {"90+": 0, "80-89": 0, "70-79": 0, "60-69": 0, "<60": 0}
        
        for name, analysis in all_strong:
            score = analysis['composite_score']
            if score >= 90:
                score_ranges["90+"] += 1
            elif score >= 80:
                score_ranges["80-89"] += 1
            elif score >= 70:
                score_ranges["70-79"] += 1
            elif score >= 60:
                score_ranges["60-69"] += 1
            else:
                score_ranges["<60"] += 1
        
        for range_name, count in score_ranges.items():
            if count > 0:
                print(f"  • {range_name}: {count} stocks")
    
    # 5. TRADING RECOMMENDATIONS
    print(f"\n\n{'-'*100}")
    print("\n💡 PRE-MARKET TRADING PREPARATION")
    print("="*100)
    
    print(f"\n🎯 TOP PRIORITY TRADES (ALL CRITERIA + HIGH SCORE):")
    
    if strong_bullish:
        strong_bullish.sort(key=lambda x: x[1]['composite_score'], reverse=True)
        print(f"\n  🟢 TOP 3 BULLISH (Sorted by Composite Score):")
        for i, (name, analysis) in enumerate(strong_bullish[:3], 1):
            ema = analysis['ema_analysis']
            ema_info = ""
            if ema:
                ema_info = f" | Above {ema['above_ema_count']}/3 EMAs"
            print(f"    {i}. {name} ({analysis['composite_score']:.0f}/100): "
                  f"₹{analysis['final_price']:.2f}, +{analysis['breakout_strength']:.2f}% above C1 high{ema_info}")
    
    if strong_bearish:
        strong_bearish.sort(key=lambda x: x[1]['composite_score'], reverse=True)
        print(f"\n  🔴 TOP 3 BEARISH (Sorted by Composite Score):")
        for i, (name, analysis) in enumerate(strong_bearish[:3], 1):
            ema = analysis['ema_analysis']
            ema_info = ""
            if ema:
                ema_info = f" | Below {3 - ema['above_ema_count']}/3 EMAs"
            print(f"    {i}. {name} ({analysis['composite_score']:.0f}/100): "
                  f"₹{analysis['final_price']:.2f}, +{analysis['breakout_strength']:.2f}% below C1 low{ema_info}")
    
    print(f"\n⚠️  WATCHLIST (Needs confirmation next day):")
    if weak_pattern_only:
        weak_bullish = [w for w in weak_pattern_only if w[1]['pattern'] == "DOUBLE_BULLISH"]
        weak_bearish = [w for w in weak_pattern_only if w[1]['pattern'] == "DOUBLE_BEARISH"]
        
        if weak_bullish:
            weak_bullish.sort(key=lambda x: x[1]['composite_score'], reverse=True)
            print(f"  🟢 Potential Bullish if volume confirms:")
            for name, analysis in weak_bullish[:2]:
                print(f"    • {name} ({analysis['composite_score']:.0f}/100): +{analysis['breakout_strength']:.2f}% above C1 high")
        
        if weak_bearish:
            weak_bearish.sort(key=lambda x: x[1]['composite_score'], reverse=True)
            print(f"  🔴 Potential Bearish if volume confirms:")
            for name, analysis in weak_bearish[:2]:
                print(f"    • {name} ({analysis['composite_score']:.0f}/100): +{analysis['breakout_strength']:.2f}% below C1 low")
    
    print(f"\n⏰ Next Market Open: Tomorrow 9:15 AM IST")
    print(f"📊 Scanner Criteria:")
    print(f"  1. Both candles same color (G/G or R/R)")
    print(f"  2. C2 closes ≥0.3% above C1 high (bullish) or ≤0.3% below C1 low (bearish)")
    print(f"  3. C1 & C2 volume > 1.2x 10-period MA")
    print(f"  4. C2 volume > 1.1x C1 volume")
    print(f"  5. Liquidity: Turnover > ₹1 Cr OR Shares > 50,000 (both candles)")
    print(f"  6. Enhanced: EMA positions (20, 50, 100) + Daily pattern analysis")
    print(f"{'='*100}")