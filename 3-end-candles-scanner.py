import pandas as pd
import yfinance as yf
import requests
import time
import random
import sys
from datetime import datetime
import io

# ────────────────────────────────────────────────
#   Get Nifty 500 symbols (top ~500 by market cap)
# ────────────────────────────────────────────────
def get_nifty500_symbols():
    url = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    }
    response = requests.get(url, headers=headers, timeout=15)
    
    if response.status_code != 200:
        raise Exception(f"Failed to download Nifty 500 list. Status: {response.status_code}")
    
    # response.text is already decoded string
    df = pd.read_csv(io.StringIO(response.text))
    
    if 'Symbol' not in df.columns:
        raise Exception("CSV does not contain 'Symbol' column. Check file format.")
    
    symbols = df['Symbol'].dropna().str.strip().unique().tolist()
    print(f"Fetched {len(symbols)} symbols from Nifty 500 list.")
    return symbols


# ────────────────────────────────────────────────
#   Main logic
# ────────────────────────────────────────────────
def main():
    symbols = get_nifty500_symbols()

    # Handle command-line argument for range (e.g. 101-200)
    start = 0
    end = 100

    if len(sys.argv) > 1:
        arg = sys.argv[1].strip()
        if '-' in arg:
            try:
                parts = arg.split('-')
                if len(parts) == 2:
                    start = int(parts[0]) - 1   # 1-based to 0-based index
                    end   = int(parts[1])
                    if start < 0 or end > len(symbols) or start >= end:
                        print(f"Invalid range: {arg}. Using default 1-100.")
                        start, end = 0, 100
                else:
                    raise ValueError
            except:
                print(f"Invalid range format: {arg}. Use e.g. 101-200. Falling back to 1-100.")
                start, end = 0, 100
        else:
            print("Invalid argument. Use format like 101-200 or leave empty for 1-100.")
            start, end = 0, 100

    selected_symbols = symbols[start:end]
    total_selected = len(selected_symbols)

    if total_selected == 0:
        print("No symbols in selected range.")
        return

    print(f"\nScanning batch {start+1}–{end} ({total_selected} stocks) ...")
    print(f"Time now: {datetime.now().strftime('%Y-%m-%d %H:%M:%S IST')}\n")

    strong_stocks = []
    weak_stocks = []

    for i, symbol in enumerate(selected_symbols):
        ticker = f"{symbol}.NS"
        print(f"  {i+1:3d}/{total_selected:3d} | {ticker}", end=" ... ", flush=True)

        for attempt in range(3):
            try:
                data = yf.download(
                    ticker,
                    interval='5m',
                    period='5d',
                    progress=False,
                    auto_adjust=True,      # modern default – silences FutureWarning
                    threads=False          # safer for many sequential calls
                )

                if len(data) < 3:
                    print("skipped (not enough data)")
                    break

                last3 = data.tail(3).copy()
                last_time = data.index[-1]

                # Only process if last candle is from today and after ~15:00
                if last_time.date() != datetime.now().date() or last_time.time() < datetime.strptime('15:00', '%H:%M').time():
                    print("skipped (data not up-to-date)")
                    break

                last3['is_green'] = last3['Close'] > last3['Open']
                last3['is_red']   = last3['Close'] < last3['Open']

                all_green = last3['is_green'].all()
                all_red   = last3['is_red'].all()

                if not (all_green or all_red):
                    print("no 3 consec same color")
                    break

                closes = last3['Close'].values
                volumes = last3['Volume'].values

                if all_green:
                    if not (closes[2] > closes[1] and closes[2] > closes[0]):
                        print("no acceleration up")
                        break
                elif all_red:
                    if not (closes[2] < closes[1] and closes[2] < closes[0]):
                        print("no acceleration down")
                        break

                if volumes[2] < 1.2 * volumes[1]:
                    print("volume < 1.2x")
                    break

                # Qualifies
                if all_green:
                    strong_stocks.append(symbol)
                    print("STRONG")
                elif all_red:
                    weak_stocks.append(symbol)
                    print("WEAK")

                break  # success

            except Exception as e:
                if attempt < 2:
                    time.sleep(random.uniform(3, 7))
                    continue
                else:
                    print(f"failed after 3 tries ({str(e)[:60]})")
                    break

        # Gentle rate limiting
        time.sleep(random.uniform(1.3, 2.6))

    # ── Save results ───────────────────────────────────────
    batch_str = f"{start+1}-{end}" if len(sys.argv) > 1 else "1-100"

    with open(f'strong_momentum_{batch_str}.txt', 'w') as f:
        f.write('\n'.join(strong_stocks))
    with open(f'weak_momentum_{batch_str}.txt', 'w') as f:
        f.write('\n'.join(weak_stocks))

    # ── Print summary ─────────────────────────────────────
    print("\n" + "="*60)
    print(f"Scan completed for batch {batch_str}")
    print(f"Strong stocks found : {len(strong_stocks)}")
    if strong_stocks:
        print("  " + ", ".join(strong_stocks))
    print(f"Weak stocks found   : {len(weak_stocks)}")
    if weak_stocks:
        print("  " + ", ".join(weak_stocks))
    print("="*60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped by user.")
    except Exception as e:
        print(f"\nUnexpected error: {e}")