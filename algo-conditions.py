import yfinance as yf
import pandas as pd
import pandas_ta as ta
import numpy as np
import datetime
import warnings

# Suppress yfinance warnings
warnings.filterwarnings("ignore", category=FutureWarning)

# Configurable settings
SYMBOLS = ['360ONE.NS', 'ABB.NS', 'ABCAPITAL.NS', 'ADANIENSOL.NS', 'ADANIENT.NS', 'ADANIGREEN.NS', 'ADANIPORTS.NS', 'ALKEM.NS', 'AMBER.NS', 'AMBUJACEM.NS', 'APOLLOHOSP.NS', 'ASHOKLEY.NS', 'ASTRAL.NS', 'AUBANK.NS', 'AUROPHARMA.NS', 'BAJAJ-AUTO.NS', 'BAJFINANCE.NS', 'BAJAJFINSV.NS', 'BANDHANBNK.NS', 'BANKBARODA.NS', 'BANKINDIA.NS', 'BEL.NS', 'BHARATFORG.NS', 'BHARTIARTL.NS', 'BHEL.NS', 'BIOCON.NS', 'BOSCHLTD.NS', 'BPCL.NS', 'BRITANNIA.NS', 'CANBK.NS', 'CGPOWER.NS', 'CHOLAFIN.NS', 'CIPLA.NS', 'COALINDIA.NS', 'COFORGE.NS', 'COLPAL.NS', 'CONCOR.NS', 'CROMPTON.NS', 'CUMMINSIND.NS', 'DABUR.NS', 'DALBHARAT.NS', 'DIVISLAB.NS', 'DMART.NS', 'DRREDDY.NS', 'EICHERMOT.NS', 'EXIDEIND.NS', 'FEDERALBNK.NS', 'GAIL.NS', 'GODREJCP.NS', 'GRASIM.NS', 'HAL.NS', 'HAVELLS.NS', 'HCLTECH.NS', 'HDFCAMC.NS', 'HDFCBANK.NS', 'HDFCLIFE.NS', 'HEROMOTOCO.NS', 'HINDALCO.NS', 'HINDPETRO.NS', 'HINDUNILVR.NS', 'ICICIBANK.NS', 'ICICIGI.NS', 'ICICIPRULI.NS', 'IDEA.NS', 'IEX.NS', 'IGL.NS', 'INDIANB.NS', 'INDIGO.NS', 'INDUSINDBK.NS', 'INDUSTOWER.NS', 'INFY.NS', 'IOC.NS','ITC.NS', 'JINDALSTEL.NS', 'JSWSTEEL.NS', 'JUBLFOOD.NS', 'KAYNES.NS', 'KOTAKBANK.NS', 'LAURUSLABS.NS', 'LICHSGFIN.NS', 'LT.NS', 'LTIM.NS', 'LUPIN.NS', 'M&M.NS', 'MANAPPURAM.NS', 'MARICO.NS', 'MARUTI.NS', 'MCX.NS', 'MFSL.NS', 'MOTHERSON.NS', 'MPHASIS.NS', 'MUTHOOTFIN.NS', 'NATIONALUM.NS', 'NAUKRI.NS', 'NESTLEIND.NS', 'NMDC.NS', 'NTPC.NS', 'OBEROIRLTY.NS', 'OFSS.NS', 'ONGC.NS', 'PAGEIND.NS', 'PERSISTENT.NS', 'PETRONET.NS', 'PFC.NS', 'PIDILITIND.NS', 'PIIND.NS', 'PNB.NS', 'POLYCAB.NS', 'POWERGRID.NS', 'RBLBANK.NS', 'RECLTD.NS', 'RELIANCE.NS', 'RVNL', 'SAIL.NS', 'SBICARD.NS', 'SBILIFE.NS', 'SBIN.NS', 'SHREECEM.NS', 'SHRIRAMFIN.NS', 'SIEMENS.NS', 'SOLARINDS.NS', 'SRF.NS', 'SUNPHARMA.NS', 'SWIGGY.NS', 'TATACONSUM.NS', 'TATAPOWER.NS', 'TATASTEEL.NS', 'TCS.NS', 'TECHM.NS', 'TITAN.NS', 'TMCV.NS', 'TMPV.NS', 'TORNTPOWER.NS', 'TRENT.NS', 'TVSMOTOR.NS','ULTRACEMCO.NS', 'UNIONBANK.NS', 'UPL.NS', 'VEDL.NS', 'VOLTAS.NS', 'WIPRO.NS', 'ANGELONE.NS', 'APLAPOLLO.NS', 'ASIANPAINT.NS', 'AXISBANK.NS', 'BAJAJHLDNG.NS', 'BDL.NS', 'BLUESTARCO.NS', 'BSE.NS', 'CAMS.NS', 'CDSL.NS', 'DELHIVERY.NS', 'DIXON.NS', 'DLF.NS', 'ETERNAL.NS', 'FORTIS.NS', 'GLENMARK.NS', 'GMRAIRPORT.NS', 'GODREJPROP.NS', 'HINDZINC.NS', 'HUDCO.NS', 'IDFCFIRSTB.NS', 'IIFL.NS', 'INDHOTEL.NS', 'INOXWIND.NS', 'IREDA.NS', 'IRFC.NS', 'JIOFIN.NS', 'JSWENERGY.NS', 'KALYANKJIL.NS', 'KEI.NS', 'KFINTECH.NS', 'KPITTECH.NS', 'LICI.NS', 'LODHA.NS', 'LTF.NS', 'MANKIND.NS', 'MAXHEALTH.NS', 'MAZDOCK.NS', 'NBCC.NS', 'NHPC.NS', 'NUVAMA.NS', 'NYKAA.NS', 'OIL.NS', 'PATANJALI.NS', 'PAYTM.NS', 'PGEL.NS', 'PHOENIXLTD.NS', 'PNBHOUSING.NS', 'POLICYBZR.NS', 'POWERINDIA.NS', 'PPLPHARMA.NS', 'PREMIERENE.NS', 'PRESTIGE.NS', 'SAMMAANCAP.NS', 'SONACOMS.NS', 'SUPREMEIND.NS', 'SUZLON.NS', 'SYNGENE.NS', 'TATAELXSI.NS', 'TATATECH.NS', 'TIINDIA.NS', 'TORNTPHARM.NS', 'UNITDSPR.NS', 'UNOMINDA.NS', 'VBL.NS', 'WAAREEENER.NS', 'YESBANK.NS', 'ZYDUSLIFE.NS']  # ← Add more stocks here
INTERVAL = '5m'
PERIOD = '5d'
STRONG_FILTER_ENABLED = False  # Strong range filter ON by default

# Time window in IST
START_TIME = "09:30:00"
END_TIME   = "15:20:00"   # Your extended window

def is_in_time_window(timestamp):
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize('Asia/Kolkata')
    else:
        timestamp = timestamp.tz_convert('Asia/Kolkata')
    time_str = timestamp.strftime("%H:%M:%S")
    return START_TIME <= time_str <= END_TIME

def fetch_data(symbol):
    try:
        df = yf.download(
            symbol,
            interval=INTERVAL,
            period=PERIOD,
            prepost=False,
            progress=False
        )
        if df.empty:
            return None
        df.index = df.index.tz_convert('Asia/Kolkata')
        return df
    except:
        return None

def check_early_momentum(df, symbol):
    if df is None or len(df) < 10:
        return None

    latest = df.iloc[-1]
    prev1  = df.iloc[-2]
    prev2  = df.iloc[-3]

    if not is_in_time_window(latest.name):
        return None

    # Safe early volume average
    early_vol_series = df['Volume'].iloc[:5].mean()
    early_vol = early_vol_series.item() if hasattr(early_vol_series, 'item') else float(early_vol_series)
    if pd.isna(early_vol) or early_vol <= 0:
        early_vol = 1.0

    # RSI(9)
    df['RSI_9'] = ta.rsi(df['Close'], length=9)

    # Current candle range
    curr_range = latest['High'] - latest['Low']
    prev_range_avg = ((prev1['High'] - prev1['Low']) + (prev2['High'] - prev2['Low'])) / 2

    # VWAP
    df['VWAP'] = ta.vwap(df['High'], df['Low'], df['Close'], df['Volume'])

    signals = []

    # Bullish check
    if (
        pd.notna(df['RSI_9'].iloc[-2]) and
        df['RSI_9'].iloc[-2] <= 35 and
        latest['RSI_9'] > 35 and
        latest['Close'] > latest['VWAP'] and
        latest['Volume'] > 1.4 * early_vol and
        latest['Close'] > prev1['High'] and
        latest['Close'] > prev2['High'] and
        latest['Close'] > latest['Open']
    ):
        if not STRONG_FILTER_ENABLED or (curr_range > 1.3 * prev_range_avg):
            signals.append(f"BUY SIGNAL - {symbol}")

    # Bearish check
    if (
        pd.notna(df['RSI_9'].iloc[-2]) and
        df['RSI_9'].iloc[-2] >= 65 and
        latest['RSI_9'] < 65 and
        latest['Close'] < latest['VWAP'] and
        latest['Volume'] > 1.4 * early_vol and
        latest['Close'] < prev1['Low'] and
        latest['Close'] < prev2['Low'] and
        latest['Close'] < latest['Open']
    ):
        if not STRONG_FILTER_ENABLED or (curr_range > 1.3 * prev_range_avg):
            signals.append(f"SELL/SHORT SIGNAL - {symbol}")

    return signals if signals else None

# ────────────────────────────────────────────────────────────────
# Main execution
# ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Early Momentum Scanner")
    print(f"Window: {START_TIME} – {END_TIME} IST")
    print(f"Strong range filter: {'ON' if STRONG_FILTER_ENABLED else 'OFF'}\n")

    matching_signals = []

    for symbol in SYMBOLS:
        df = fetch_data(symbol)
        if df is not None:
            result = check_early_momentum(df, symbol)
            if result:
                matching_signals.extend(result)

    # ──── Final clean output ────
    if matching_signals:
        print("MATCHING SIGNALS FOUND:")
        for sig in matching_signals:
            print(sig)
    else:
        print("No matching signals found in the current window.")

    print("\nScan finished.")