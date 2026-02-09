# -*- coding: utf-8 -*-

"""
5-min FnO Weak Stock Scanner (Zerodha)
- Auto runs every 5 minutes
- Multi-run confirmation logic
- STATUS LINE added (Warm-up / Confirming / Confirmed)
- Stops at 2:45 PM
"""

import time
import pytz
import pandas as pd
from datetime import datetime, time as dtime
from kiteconnect import KiteConnect

# ================= CONFIG ================= #

API_KEY = "tpwjbkqec6xshvau"
ACCESS_TOKEN = "CNsIkvYSgkvpmAajTcJ20LPFCMtZpGbW"

SCAN_INTERVAL_SECONDS = 300  # 5 minutes
START_CONFIRM_TIME = dtime(9, 45)
STOP_TIME = dtime(14, 45)

MAX_CONFIRMED = 3
WEAK_SCORE_THRESHOLD = 60

IST = pytz.timezone("Asia/Kolkata")

# ================= ZERODHA INIT ================= #

kite = KiteConnect(api_key=API_KEY)
kite.set_access_token(ACCESS_TOKEN)

# ================= STATE ================= #

state = {}  # per-stock memory
scan_count = 0

# ================= UTILITIES ================= #

def now_ist():
    return datetime.now(IST)

def is_after_confirm_time():
    return now_ist().time() >= START_CONFIRM_TIME

def should_stop():
    return now_ist().time() >= STOP_TIME

# ================= DATA FETCH ================= #

def get_fno_symbols():
    instruments = kite.instruments("NFO")
    df = pd.DataFrame(instruments)
    df = df[df["segment"] == "NFO-FUT"]
    return df["tradingsymbol"].unique().tolist()

# ================= WEAKNESS LOGIC ================= #

def calculate_vwap(df):
    pv = (df["close"] * df["volume"]).cumsum()
    vol = df["volume"].cumsum()
    return pv / vol

def weakness_score(df):
    if len(df) < 3:
        return 0

    last = df.iloc[-1]
    prev = df.iloc[-2]

    score = 0

    if last["close"] < prev["close"]:
        score += 20

    if last["volume"] > df["volume"].mean():
        score += 15

    vwap = calculate_vwap(df).iloc[-1]
    if last["close"] < vwap:
        score += 20

    if "oi" in df.columns and last.get("oi", 0) > prev.get("oi", 0):
        score += 25

    return score

# ================= MEMORY HANDLING ================= #

def update_state(symbol, is_weak):
    record = state.setdefault(symbol, {"history": [], "confirmed": False})
    record["history"].append(is_weak)
    record["history"] = record["history"][-4:]

def confirmation_status(symbol):
    history = state[symbol]["history"]

    if not is_after_confirm_time():
        return "WARM-UP"

    if history.count(True) >= 3:
        return "CONFIRMED"

    if history.count(True) >= 2:
        return "CONFIRMING"

    return "WATCH"

# ================= MAIN LOOP ================= #

def run_scanner():
    global scan_count

    print("🚀 FnO Weak Stock Scanner Started")
    symbols = get_fno_symbols()

    while True:
        if should_stop():
            print("⏹ Scanner stopped at 2:45 PM")
            break

        scan_count += 1
        print(f"\n🔄 Scan #{scan_count} at {now_ist().strftime('%H:%M:%S')}")

        confirmed = []

        for symbol in symbols:
            try:
                ltp = kite.ltp(f"NFO:{symbol}")[f"NFO:{symbol}"]
                token = ltp["instrument_token"]

                to_date = now_ist()
                from_date = to_date - pd.Timedelta(minutes=30)
                data = kite.historical_data(token, from_date, to_date, interval="5minute")
                df = pd.DataFrame(data)

                if df.empty:
                    continue

                score = weakness_score(df)
                is_weak = score >= WEAK_SCORE_THRESHOLD

                update_state(symbol, is_weak)
                status = confirmation_status(symbol)

                if status == "CONFIRMED":
                    confirmed.append((symbol, score))

            except Exception:
                continue

        confirmed = sorted(confirmed, key=lambda x: x[1], reverse=True)[:MAX_CONFIRMED]

        if confirmed:
            print("🟥 CONFIRMED WEAK STOCKS:")
            for sym, sc in confirmed:
                print(f"  {sym} | Score: {sc} | Status: CONFIRMED")
        else:
            print("Status: WARM-UP / CONFIRMING — No confirmed weak stocks yet")

        time.sleep(SCAN_INTERVAL_SECONDS)

# ================= START ================= #

if __name__ == "__main__":
    run_scanner()