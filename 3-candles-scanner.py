# save as intraday_3candle_highlow_all_scanner.py
# Requires: pip install yfinance pandas pytz
# Run after 09:30 AM IST

import pandas as pd
import yfinance as yf
from datetime import datetime, time
import pytz
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

IST = pytz.timezone("Asia/Kolkata")
MARKET_OPEN = time(9, 15)

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
"BAJAJHLDNG": "BAJAJHLDNG.NS",
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
"MARUTI": "MARUTI.NS",
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
"ZYDUSLIFE": "ZYDUSLIFE.NS",
"NSEI": "^NSEI"
}

def get_today_5m(symbol):
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

def first_three_candles(df):
    today = datetime.now(IST).date()
    df_today = df[df.index.date == today]

    if df_today.empty:
        return None

    df_after_open = df_today[df_today.index.time >= MARKET_OPEN]

    if len(df_after_open) < 3:
        return None

    return df_after_open.iloc[:3]

def check_volume_confirmation(three_candles):
    """Check if 3rd candle volume is higher than both first two candles"""
    if three_candles is None or len(three_candles) < 3:
        return "INSUFFICIENT_DATA"
    
    v1 = three_candles['Volume'].iloc[0]
    v2 = three_candles['Volume'].iloc[1]
    v3 = three_candles['Volume'].iloc[2]
    
    if v3 > v1 and v3 > v2:
        return "VOL_CONFIRMED"
    else:
        return "VOL_LOW"

def get_volume_icon(status):
    """Get emoji icon for volume status"""
    if status == "VOL_CONFIRMED":
        return "✅"
    elif status == "VOL_LOW":
        return "❌"
    elif status == "INSUFFICIENT_DATA":
        return "➖"
    else:
        return "➖"

def get_volume_text(status):
    """Get text description for volume status"""
    if status == "VOL_CONFIRMED":
        return "VOL_CONFIRMED"
    elif status == "VOL_LOW":
        return "VOL_LOW"
    elif status == "INSUFFICIENT_DATA":
        return "INSUFF_DATA"
    else:
        return "VOL_MIXED"

if __name__ == "__main__":
    print(f"Running 3-Candle High/Low Breakout Scanner at {datetime.now(IST).strftime('%H:%M:%S')}")
    print("=" * 80)
    
    # Store all stocks meeting the price criteria
    bullish_breakouts = []      # C3 > high of C1 and C2
    bearish_breakouts = []      # C3 < low of C1 and C2
    
    for name, symbol in SYMBOLS.items():
        df = get_today_5m(symbol)

        if df is None:
            continue

        three = first_three_candles(df)

        if three is None:
            continue

        # Get OHLC data
        h1, h2, h3 = three['High'].values
        l1, l2, l3 = three['Low'].values
        c1, c2, c3 = three['Close'].values
        
        # Calculate highest high and lowest low of first two candles
        highest_high_c1c2 = max(h1, h2)
        lowest_low_c1c2 = min(l1, l2)
        
        # Check volume confirmation
        volume_status = check_volume_confirmation(three)
        volume_icon = get_volume_icon(volume_status)
        volume_text = get_volume_text(volume_status)
        
        # Calculate percentage moves
        move_from_c1 = ((c3 - c1) / c1) * 100
        breakout_strength = 0
        
        # Determine pattern
        if c3 > highest_high_c1c2:
            breakout_strength = ((c3 - highest_high_c1c2) / highest_high_c1c2) * 100
            bullish_breakouts.append((name, c3, highest_high_c1c2, breakout_strength, 
                                     move_from_c1, volume_icon, volume_text, c1, c2))
        elif c3 < lowest_low_c1c2:
            breakout_strength = ((lowest_low_c1c2 - c3) / lowest_low_c1c2) * 100
            bearish_breakouts.append((name, c3, lowest_low_c1c2, breakout_strength,
                                     move_from_c1, volume_icon, volume_text, c1, c2))

    # Summary Statistics
    print("\n" + "═"*80)
    print("📊 SUMMARY STATISTICS")
    print("═"*80)
    print(f"Total Stocks Scanned: {len(SYMBOLS)}")
    print(f"Bullish Breakouts: {len(bullish_breakouts)}")
    print(f"Bearish Breakouts: {len(bearish_breakouts)}")
    print(f"Insufficient Data: {len(SYMBOLS) - len(bullish_breakouts) - len(bearish_breakouts)}")
    
    # Volume Analysis
    bull_vol_confirmed = len([b for b in bullish_breakouts if b[6] == "VOL_CONFIRMED"])
    bull_vol_low = len([b for b in bullish_breakouts if b[6] == "VOL_LOW"])
    bear_vol_confirmed = len([b for b in bearish_breakouts if b[6] == "VOL_CONFIRMED"])
    bear_vol_low = len([b for b in bearish_breakouts if b[6] == "VOL_LOW"])
    
    print(f"\nVolume Analysis:")
    print(f"  Bullish with Volume Confirmation: {bull_vol_confirmed}")
    print(f"  Bullish with Low Volume: {bull_vol_low}")
    print(f"  Bearish with Volume Confirmation: {bear_vol_confirmed}")
    print(f"  Bearish with Low Volume: {bear_vol_low}")

    # Trading Recommendations
    print("\n" + "═"*80)
    print("💡 INTRADAY TRADING RECOMMENDATIONS")
    print("═"*80)
    
    # ALL Bullish candidates (sorted by breakout strength)
    if bullish_breakouts:
        bullish_breakouts.sort(key=lambda x: x[3], reverse=True)  # Sort by breakout strength
        print("ALL Bullish Breakout Candidates (Sorted by Strength):")
        for i, (name, c3, high_c1c2, breakout_str, move_pct, vol_icon, vol_text, c1, c2) in enumerate(bullish_breakouts, 1):
            volume_status = "✅ VOL" if vol_text == "VOL_CONFIRMED" else "❌ LOW VOL"
            print(f"  {i}. {name}: Breakout +{breakout_str:.2f}%, Move {move_pct:+.2f}%, {volume_status} (Entry ~₹{c3:.2f})")
    else:
        print("No bullish breakout candidates")
    
    # ALL Bearish candidates (sorted by breakdown strength)
    if bearish_breakouts:
        bearish_breakouts.sort(key=lambda x: x[3], reverse=True)  # Sort by breakdown strength
        print("\nALL Bearish Breakdown Candidates (Sorted by Strength):")
        for i, (name, c3, low_c1c2, breakout_str, move_pct, vol_icon, vol_text, c1, c2) in enumerate(bearish_breakouts, 1):
            volume_status = "✅ VOL" if vol_text == "VOL_CONFIRMED" else "❌ LOW VOL"
            print(f"  {i}. {name}: Breakdown +{breakout_str:.2f}%, Move {move_pct:+.2f}%, {volume_status} (Entry ~₹{c3:.2f})")
    else:
        print("\nNo bearish breakdown candidates")
    
    # Separate section for volume-confirmed only (priority trades)
    print("\n" + "═"*80)
    print("🎯 PRIORITY TRADES (BREAKOUT + VOLUME CONFIRMED)")
    print("═"*80)
    
    # Volume-confirmed bullish candidates
    strong_bullish = [b for b in bullish_breakouts if b[6] == "VOL_CONFIRMED"]
    if strong_bullish:
        strong_bullish.sort(key=lambda x: x[3], reverse=True)
        print("Bullish (Volume Confirmed):")
        for i, (name, c3, high_c1c2, breakout_str, move_pct, vol_icon, vol_text, c1, c2) in enumerate(strong_bullish, 1):
            print(f"  {i}. {name}: Breakout +{breakout_str:.2f}%, Total Move {move_pct:+.2f}%")
    else:
        print("No bullish candidates with volume confirmation")
    
    # Volume-confirmed bearish candidates
    strong_bearish = [b for b in bearish_breakouts if b[6] == "VOL_CONFIRMED"]
    if strong_bearish:
        strong_bearish.sort(key=lambda x: x[3], reverse=True)
        print("\nBearish (Volume Confirmed):")
        for i, (name, c3, low_c1c2, breakout_str, move_pct, vol_icon, vol_text, c1, c2) in enumerate(strong_bearish, 1):
            print(f"  {i}. {name}: Breakdown +{breakout_str:.2f}%, Total Move {move_pct:+.2f}%")
    else:
        print("\nNo bearish candidates with volume confirmation")
    
    print(f"\nScan completed at: {datetime.now(IST).strftime('%H:%M:%S')}")