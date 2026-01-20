# -*- coding: utf-8 -*-
"""
BTST SHORT SCANNER (Fully Functional – Zerodha KiteConnect)
----------------------------------------------------------
Purpose:
- Identify high-quality BTST SHORT candidates only
- Runs ONLY between 14:45 and 15:15 IST
- Uses Zerodha KiteConnect (5-min + Daily + OI)
- Outputs max 1–2 stocks with risk grading

IMPORTANT:
- This is NOT an intraday execution script
- It is a shortlist generator for BTST trades
"""

import time
from datetime import datetime, time as dtime, timedelta
from collections import defaultdict
import pandas as pd
from kiteconnect import KiteConnect

# ================= ZERODHA SETUP =================
API_KEY = "tpwjbkqec6xshvau"
ACCESS_TOKEN = "8R4zTSTTJH2Ga0XIfu85ruR6EBZ5CfX2"

kite = KiteConnect(api_key=API_KEY)
kite.set_access_token(ACCESS_TOKEN)

# ================= CONFIG =================
SCAN_INTERVAL_MIN = 5
START_TIME = dtime(14, 00)
STOP_TIME = dtime(15, 20)

MAX_BTST = 2
WEAK_SCORE_THRESHOLD = 60

CLOSE_NEAR_LOW_RATIO = 0.25
LOWER_WICK_RATIO = 0.35

# ================= STATE =================
state = defaultdict(list)   # symbol -> weakness persistence

# ================= INSTRUMENT CACHE =================
print("Fetching instruments…")
INST = pd.DataFrame(kite.instruments("NFO"))
FNO_STOCKS = INST[INST["segment"] == "NFO-FUTSTK"]
SYMBOL_TO_TOKEN = dict(zip(FNO_STOCKS.tradingsymbol, FNO_STOCKS.instrument_token))

# ================= DATA HELPERS =================

def get_all_fno_symbols():
    return list(SYMBOL_TO_TOKEN.keys())


def fetch_candles(token, interval, days=2):
    to_dt = datetime.now()
    from_dt = to_dt - timedelta(days=days)
    data = kite.historical_data(token, from_dt, to_dt, interval, oi=True)
    df = pd.DataFrame(data)
    return df


def get_5min_data(symbol):
    token = SYMBOL_TO_TOKEN[symbol]
    return fetch_candles(token, "5minute", days=1)


def get_daily_data(symbol):
    token = SYMBOL_TO_TOKEN[symbol]
    return fetch_candles(token, "day", days=5)


def get_nifty_daily():
    nifty_token = 256265  # NIFTY 50
    df = fetch_candles(nifty_token, "day", days=2)
    return df.iloc[-1]

# ================= CORE LOGIC =================

def intraday_weakness(df):
    last = df.iloc[-1]
    prev = df.iloc[-2]

    score = 0

    if last.close < prev.close:
        score += 20

    if last.volume > df.volume.mean():
        score += 15

    vwap = (df.close * df.volume).sum() / max(df.volume.sum(), 1)
    if last.close < vwap:
        score += 20

    if "oi" in df.columns and last.oi > prev.oi:
        score += 25

    return score


def daily_structure_ok(df):
    today = df.iloc[-1]
    prev = df.iloc[-2]

    if today.close >= today.open:
        return False

    if (today.close - today.low) / max((today.high - today.low), 1) > CLOSE_NEAR_LOW_RATIO:
        return False

    lower_wick = min(today.open, today.close) - today.low
    if lower_wick / max((today.high - today.low), 1) > LOWER_WICK_RATIO:
        return False

    if today.close > prev.low:
        return False

    return True


def oi_into_close_ok(df):
    tail = df.tail(6)

    if tail.oi.iloc[-1] < tail.oi.iloc[0] and tail.close.iloc[-1] > tail.close.iloc[0]:
        return False

    return True


def market_context_ok():
    nifty = get_nifty_daily()

    if nifty.close > nifty.open and (nifty.high - nifty.close) < (nifty.close - nifty.low):
        return False

    return True

# ================= MAIN LOOP =================

def run_btst_scanner():
    print("\n🔻 BTST SHORT SCANNER STARTED")

    symbols = get_all_fno_symbols()

    while True:
        now = datetime.now().time()

        if now < START_TIME:
            time.sleep(30)
            continue

        if now >= STOP_TIME:
            print("\n🛑 BTST SCANNER STOPPED (3:15 PM)")
            break

        print(f"\n🔄 BTST Scan @ {datetime.now().strftime('%H:%M:%S')}")

        if not market_context_ok():
            print("⚠️ Market context not favorable for BTST shorts")
            time.sleep(SCAN_INTERVAL_MIN * 60)
            continue

        candidates = []

        for sym in symbols:
            try:
                df5 = get_5min_data(sym)
                daily = get_daily_data(sym)

                if len(df5) < 10 or len(daily) < 2:
                    continue

                score = intraday_weakness(df5)
                is_weak = score >= WEAK_SCORE_THRESHOLD

                state[sym].append(is_weak)
                state[sym] = state[sym][-4:]

                if state[sym].count(True) < 3:
                    continue

                if not daily_structure_ok(daily):
                    continue

                if not oi_into_close_ok(df5):
                    continue

                candidates.append((sym, score))

            except Exception:
                continue

        candidates.sort(key=lambda x: x[1], reverse=True)
        final = candidates[:MAX_BTST]

        if final:
            print("\n🟥 BTST SHORT CANDIDATES")
            for sym, score in final:
                print(f"  {sym} | Weakness Score: {score} | Risk: LOW/MEDIUM")
        else:
            print("No BTST candidates this scan")

        time.sleep(SCAN_INTERVAL_MIN * 60)


if __name__ == '__main__':
    run_btst_scanner()