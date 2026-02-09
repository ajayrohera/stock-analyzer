import yfinance as yf
import pandas as pd
import pandas_ta as ta
import numpy as np
import datetime
import warnings
import requests

warnings.filterwarnings("ignore", category=FutureWarning)

# Config
INTERVAL = '5m'
PERIOD = '5d'
STRONG_FILTER_ENABLED = True
START_TIME = "09:30:00"
END_TIME   = "10:45:00"

def get_fo_stocks():
    url = "https://archives.nseindia.com/content/fo/fo_mktlots.csv"
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        df_csv = pd.read_csv(pd.compat.StringIO(response.text))
        stocks = df_csv[df_csv['SYMBOL'].str.match(r'^[A-Z]{2,}$')]['SYMBOL'].unique()
        return [s.strip() + '.NS' for s in stocks if len(s.strip()) > 1]
    except Exception as e:
        print(f"Could not fetch F&O list: {e}")
        print("Using fallback small list...")
        return ['RELIANCE.NS', 'TRENT.NS', 'HDFCBANK.NS', 'INFY.NS', 'TCS.NS', 'AXISBANK.NS']

def is_in_time_window(timestamp):
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize('Asia/Kolkata')
    else:
        timestamp = timestamp.tz_convert('Asia/Kolkata')
    return START_TIME <= timestamp.strftime("%H:%M:%S") <= END_TIME

def fetch_data(symbol):
    try:
        df = yf.download(symbol, interval=INTERVAL, period=PERIOD, prepost=False, progress=False)
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
    if not is_in_time_window(latest.name):
        return None

    prev1 = df.iloc[-2]
    prev2 = df.iloc[-3]

    # FIXED: Robust scalar extraction for volume mean
    mean_vol = df['Volume'].iloc[:5].mean()
    early_vol = mean_vol.item() if hasattr(mean_vol, 'item') else float(mean_vol or 1.0)
    early_vol = max(early_vol, 1.0)

    df['RSI_9'] = ta.rsi(df['Close'], length=9)
    df['VWAP'] = ta.vwap(df['High'], df['Low'], df['Close'], df['Volume'])

    curr_range = latest['High'] - latest['Low']
    prev_range_avg = ((prev1['High'] - prev1['Low']) + (prev2['High'] - prev2['Low'])) / 2

    signals = []

    # Bullish
    if (
        pd.notna(df['RSI_9'].iloc[-2]) and df['RSI_9'].iloc[-2] <= 35 and latest['RSI_9'] > 35 and
        latest['Close'] > latest['VWAP'] and
        latest['Volume'] > 1.4 * early_vol and
        latest['Close'] > prev1['High'] and latest['Close'] > prev2['High'] and
        latest['Close'] > latest['Open']
    ):
        if not STRONG_FILTER_ENABLED or (curr_range > 1.3 * prev_range_avg):
            signals.append(f"BUY SIGNAL - {symbol}")

    # Bearish
    if (
        pd.notna(df['RSI_9'].iloc[-2]) and df['RSI_9'].iloc[-2] >= 65 and latest['RSI_9'] < 65 and
        latest['Close'] < latest['VWAP'] and
        latest['Volume'] > 1.4 * early_vol and
        latest['Close'] < prev1['Low'] and latest['Close'] < prev2['Low'] and
        latest['Close'] < latest['Open']
    ):
        if not STRONG_FILTER_ENABLED or (curr_range > 1.3 * prev_range_avg):
            signals.append(f"SELL/SHORT SIGNAL - {symbol}")

    return signals if signals else None

if __name__ == "__main__":
    print("Early Momentum Scanner – All NSE F&O Stocks")
    print(f"Window: {START_TIME} – {END_TIME} IST")
    print(f"Strong filter: {'ON' if STRONG_FILTER_ENABLED else 'OFF'}\n")

    symbols = get_fo_stocks()
    print(f"Scanning {len(symbols)} F&O stocks...")

    matching_signals = []

    for symbol in symbols:
        df = fetch_data(symbol)
        if df is not None:
            result = check_early_momentum(df, symbol)
            if result:
                matching_signals.extend(result)

    if matching_signals:
        print("\nMATCHING SIGNALS FOUND:")
        for sig in matching_signals:
            print(sig)
    else:
        print("\nNo matching signals found in the current window.")

    print("\nScan finished.")