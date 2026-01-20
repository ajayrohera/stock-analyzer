from smart_detector import detect_smart_money
from kiteconnect import KiteConnect
import time
import schedule
from datetime import datetime, timedelta

# Your Zerodha API info
api_key = "tpwjbkqec6xshvau"
access_token = "u6ZcAdyC608Zylq3qJxBHNwzz5bWENoz"

# Global variables for crude oil tracking
active_trades = {}
candle_history = {}
trade_log = []
signal_confirmation = {}
volume_history = {}


def setup_kite():
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    return kite


def get_current_crude_symbol(kite):
    """Automatically find the current crude oil futures contract"""
    try:
        # Search for crude oil instruments
        instruments = kite.instruments("MCX")
        crude_instruments = [inst for inst in instruments if inst['name'] == 'CRUDEOIL']
        
        if not crude_instruments:
            return "CRUDEOIL"  # Fallback
        
        # Find the nearest expiry future that's still trading
        today = datetime.now().date()
        valid_crude = [inst for inst in crude_instruments 
                      if inst['expiry'] and inst['expiry'] >= today]
        
        if valid_crude:
            # Sort by expiry and get the nearest one
            valid_crude.sort(key=lambda x: x['expiry'])
            return valid_crude[0]['tradingsymbol']
        else:
            # If no valid futures, use the first one available
            return crude_instruments[0]['tradingsymbol']
    except Exception as e:
        print(f"⚠️ Could not auto-detect crude symbol: {e}")
        # Return a common crude oil symbol pattern
        return "CRUDEOILM24FUT"  # Common pattern: CRUDEOIL + Month + Year + FUT


def is_mcx_market_open():
    """Check if MCX market is open (9:00 AM to 11:30 PM)"""
    now = datetime.now()
    current_time = now.strftime("%H:%M")
    
    # MCX market hours: 9:00 AM to 11:30 PM
    return "09:00" <= current_time <= "23:30"


def should_enter_trade(symbol, signal, current_time):
    """Avoid trading during volatile periods for crude"""
    hour = current_time.hour
    minute = current_time.minute
    
    # Avoid first 30 minutes (too volatile)
    if hour == 9 and minute <= 30:
        return False, "Crude too volatile - first 30 minutes"
        
    # Avoid last 60 minutes (unpredictable)
    if hour == 22 and minute >= 30:
        return False, "Crude market closing - last 60 minutes"
        
    # Avoid major news times (simplified)
    if hour in [14, 18, 22] and minute <= 15:  # Approximate news times
        return False, "Potential news volatility"
    
    # Don't enter new trades in last 2 hours if we already have positions
    if hour >= 21 and active_trades:
        return False, "Last 2 hours - reducing exposure"
        
    return True, "Time check passed"


def is_volume_quality_good(symbol, current_volume, average_volume):
    """Check if volume is sustainable for crude"""
    if symbol not in volume_history:
        volume_history[symbol] = []
    
    # Add current volume to history (keep last 10 readings)
    volume_history[symbol].append(current_volume)
    if len(volume_history[symbol]) > 10:
        volume_history[symbol].pop(0)
    
    # Need at least 5 readings for quality check
    if len(volume_history[symbol]) < 5:
        return True, "Insufficient volume history"
    
    # Check if volume is consistently above average (crude needs higher volume)
    recent_volumes = volume_history[symbol][-5:]  # Last 5 readings
    avg_recent_volume = sum(recent_volumes) / len(recent_volumes)
    
    volume_ratio = avg_recent_volume / average_volume if average_volume > 0 else 1
    
    if volume_ratio > 1.5:
        return True, f"Excellent volume consistency (ratio: {volume_ratio:.2f})"
    elif volume_ratio > 1.2:
        return True, f"Good volume consistency (ratio: {volume_ratio:.2f})"
    else:
        return False, f"Poor volume consistency (ratio: {volume_ratio:.2f})"


def confirm_signal(symbol, signal):
    """Wait for signal to persist for multiple scans"""
    if symbol not in signal_confirmation:
        signal_confirmation[symbol] = {'signal': signal, 'count': 1, 'first_seen': datetime.now()}
        return False, f"Signal first seen - need confirmation"
    
    current_signal_data = signal_confirmation[symbol]
    
    # If signal is the same, increment count
    if current_signal_data['signal'] == signal:
        current_signal_data['count'] += 1
        
        if current_signal_data['count'] >= 2:
            return True, f"Signal confirmed ({current_signal_data['count']} consecutive scans)"
        else:
            return False, f"Signal needs confirmation ({current_signal_data['count']}/2)"
    else:
        # Signal changed, reset counter
        signal_confirmation[symbol] = {'signal': signal, 'count': 1, 'first_seen': datetime.now()}
        return False, "Signal changed - reset confirmation"


def is_with_trend(symbol, data_history):
    """Trend check specifically for crude oil"""
    if len(data_history) < 8:  # Need at least 40 minutes of data for crude
        return True, "Insufficient data for trend check"
    
    # Use last 8 data points (40 minutes) for trend
    recent_prices = [data['last_price'] for data in data_history[-8:]]
    trend_price = sum(recent_prices) / len(recent_prices)
    current_price = data_history[-1]['last_price']
    
    trend_strength = abs(current_price - trend_price) / trend_price * 100
    
    # Crude-specific trend logic
    if current_price > trend_price and trend_strength > 0.1:
        return True, f"Strong uptrend (+{trend_strength:.2f}% above average)"
    elif current_price < trend_price and trend_strength > 0.1:
        return True, f"Strong downtrend (-{trend_strength:.2f}% below average)"
    else:
        return False, f"Weak trend ({trend_strength:.2f}%) - sideways market"


def enhanced_signal_validation(symbol, signal, current_data, data_history, current_time):
    """Multiple checks to reduce false signals for crude"""
    
    validation_results = []
    
    # Check 1: Time filter
    time_ok, time_msg = should_enter_trade(symbol, signal, current_time)
    validation_results.append((time_ok, f"Time: {time_msg}"))
    
    # Check 2: Volume quality (stricter for crude)
    volume_ok, volume_msg = is_volume_quality_good(symbol, current_data['volume'], current_data['average_volume'])
    validation_results.append((volume_ok, f"Volume: {volume_msg}"))
    
    # Check 3: Signal confirmation
    confirmation_ok, confirmation_msg = confirm_signal(symbol, signal)
    validation_results.append((confirmation_ok, f"Confirmation: {confirmation_msg}"))
    
    # Check 4: Trend alignment (stricter for crude)
    trend_ok, trend_msg = is_with_trend(symbol, data_history)
    validation_results.append((trend_ok, f"Trend: {trend_msg}"))
    
    # Count passed checks
    passed_checks = sum(1 for check_ok, _ in validation_results if check_ok)
    total_checks = len(validation_results)
    
    # Require at least 3 out of 4 checks to pass (stricter for crude)
    is_valid = passed_checks >= 3
    
    return is_valid, passed_checks, total_checks, validation_results


def manage_position(symbol, signal, current_price, is_signal_valid):
    """Manage trade entries and exits for crude"""
    global active_trades, trade_log
    
    current_time = datetime.now()
    
    # EXIT LOGIC: If we have opposite signal to our position
    if symbol in active_trades:
        trade = active_trades[symbol]
        
        # Exit long position if SELL signal appears
        if trade['direction'] == 'LONG' and 'SELL' in signal and is_signal_valid:
            pnl_percent = (current_price - trade['entry_price']) / trade['entry_price'] * 100
            pnl_absolute = current_price - trade['entry_price']
            
            print(f"🛢️📉 EXIT LONG CRUDE: {symbol} at ₹{current_price:.2f} (PnL: {pnl_percent:+.2f}%)")
            
            # Log the trade
            trade_log.append({
                'symbol': symbol,
                'direction': 'LONG',
                'entry_price': trade['entry_price'],
                'exit_price': current_price,
                'entry_time': trade['entry_time'],
                'exit_time': current_time,
                'pnl_percent': pnl_percent,
                'pnl_absolute': pnl_absolute,
                'duration_minutes': (current_time - trade['entry_time']).total_seconds() / 60
            })
            
            del active_trades[symbol]
            return f"EXIT_LONG_{symbol}"
            
        # Exit short position if BUY signal appears  
        elif trade['direction'] == 'SHORT' and 'BUY' in signal and is_signal_valid:
            pnl_percent = (trade['entry_price'] - current_price) / trade['entry_price'] * 100
            pnl_absolute = trade['entry_price'] - current_price
            
            print(f"🛢️📈 EXIT SHORT CRUDE: {symbol} at ₹{current_price:.2f} (PnL: {pnl_percent:+.2f}%)")
            
            # Log the trade
            trade_log.append({
                'symbol': symbol,
                'direction': 'SHORT', 
                'entry_price': trade['entry_price'],
                'exit_price': current_price,
                'entry_time': trade['entry_time'],
                'exit_time': current_time,
                'pnl_percent': pnl_percent,
                'pnl_absolute': pnl_absolute,
                'duration_minutes': (current_time - trade['entry_time']).total_seconds() / 60
            })
            
            del active_trades[symbol]
            return f"EXIT_SHORT_{symbol}"
    
    # ENTRY LOGIC: New signals when no active position (only if validated)
    elif symbol not in active_trades and is_signal_valid:
        if 'BUY' in signal and 'STRONG BUY' in signal:
            # Enter long position
            active_trades[symbol] = {
                'entry_price': current_price,
                'entry_time': current_time,
                'direction': 'LONG',
                'signal_strength': 'STRONG'
            }
            print(f"🛢️📈 ENTER LONG CRUDE: {symbol} at ₹{current_price:.2f}")
            return f"ENTER_LONG_{symbol}"
            
        elif 'BUY' in signal:
            # Enter long position (regular)
            active_trades[symbol] = {
                'entry_price': current_price,
                'entry_time': current_time,
                'direction': 'LONG', 
                'signal_strength': 'REGULAR'
            }
            print(f"🛢️📈 ENTER LONG CRUDE: {symbol} at ₹{current_price:.2f}")
            return f"ENTER_LONG_{symbol}"
            
        elif 'SELL' in signal and 'STRONG SELL' in signal:
            # Enter short position
            active_trades[symbol] = {
                'entry_price': current_price,
                'entry_time': current_time,
                'direction': 'SHORT',
                'signal_strength': 'STRONG'
            }
            print(f"🛢️📉 ENTER SHORT CRUDE: {symbol} at ₹{current_price:.2f}")
            return f"ENTER_SHORT_{symbol}"
            
        elif 'SELL' in signal:
            # Enter short position (regular)
            active_trades[symbol] = {
                'entry_price': current_price,
                'entry_time': current_time,
                'direction': 'SHORT',
                'signal_strength': 'REGULAR'
            }
            print(f"🛢️📉 ENTER SHORT CRUDE: {symbol} at ₹{current_price:.2f}")
            return f"ENTER_SHORT_{symbol}"
    
    return None


def show_active_positions():
    """Display current active positions"""
    if active_trades:
        print("\n📊 ACTIVE CRUDE POSITIONS:")
        for symbol, trade in active_trades.items():
            current_time = datetime.now()
            duration = (current_time - trade['entry_time']).total_seconds() / 60
            print(f"   {symbol}: {trade['direction']} | Entry: ₹{trade['entry_price']:.2f} | Duration: {duration:.1f}m")
    else:
        print("\n📊 No active crude positions")


def show_daily_summary():
    """Show daily trading summary for crude"""
    if trade_log:
        print("\n🛢️📈 DAILY CRUDE TRADING SUMMARY:")
        total_trades = len(trade_log)
        winning_trades = [t for t in trade_log if t['pnl_percent'] > 0]
        losing_trades = [t for t in trade_log if t['pnl_percent'] < 0]
        break_even_trades = [t for t in trade_log if t['pnl_percent'] == 0]
        
        total_pnl = sum(t['pnl_absolute'] for t in trade_log)
        total_pnl_percent = sum(t['pnl_percent'] for t in trade_log)
        win_rate = len(winning_trades) / total_trades * 100 if total_trades > 0 else 0
        
        print(f"   Total Trades: {total_trades}")
        print(f"   Winning Trades: {len(winning_trades)}")
        print(f"   Losing Trades: {len(losing_trades)}")
        print(f"   Break-even Trades: {len(break_even_trades)}")
        print(f"   Win Rate: {win_rate:.1f}%")
        print(f"   Total P&L: ₹{total_pnl:.2f} ({total_pnl_percent:+.2f}%)")
        
        if winning_trades:
            avg_win = sum(t['pnl_percent'] for t in winning_trades) / len(winning_trades)
            print(f"   Average Win: +{avg_win:.2f}%")
        if losing_trades:
            avg_loss = sum(t['pnl_percent'] for t in losing_trades) / len(losing_trades)
            print(f"   Average Loss: {avg_loss:.2f}%")
        
        print(f"\n   Trade Details:")
        for i, trade in enumerate(trade_log, 1):
            status = "✅" if trade['pnl_percent'] > 0 else "❌" if trade['pnl_percent'] < 0 else "➖"
            print(f"   {i}. {status} {trade['symbol']} {trade['direction']}: ₹{trade['pnl_absolute']:+.2f} ({trade['pnl_percent']:+.2f}%)")
    else:
        print("\n🛢️ No crude trades today")


def scan_crude_market():
    if not is_mcx_market_open():
        print("❌ MCX market is closed. No crude data available.")
        print("   MCX Hours: 9:00 AM - 11:30 PM")
        return
        
    current_time = datetime.now()
    print(f"\n🛢️🔍 Scanning Crude Oil at {current_time.strftime('%H:%M:%S')}...")
    
    try:
        kite = setup_kite()
        
        # Get current crude symbol
        crude_symbol = get_current_crude_symbol(kite)
        symbol_display = f"CRUDEOIL ({crude_symbol})"
        
        print(f"   Using symbol: {crude_symbol}")
        
        try:
            # Get real-time data for crude
            quote = kite.quote(f"MCX:{crude_symbol}")
            data = quote[f"MCX:{crude_symbol}"]
            current_price = data['last_price']
            
            # Prepare current candle data
            current_candle = {
                'open': data['ohlc']['open'],
                'high': data['ohlc']['high'],
                'low': data['ohlc']['low'], 
                'last_price': current_price,
                'volume': data['volume'],
                'buy_quantity': data['depth']['buy'][0]['quantity'],
                'sell_quantity': data['depth']['sell'][0]['quantity'],
                'average_volume': data.get('average_volume', data['volume'])  # Handle missing average_volume
            }
            
            # Initialize data history for crude
            if crude_symbol not in candle_history:
                candle_history[crude_symbol] = []
            
            # Add current candle to history (keep last 15 readings)
            candle_history[crude_symbol].append(current_candle)
            if len(candle_history[crude_symbol]) > 15:
                candle_history[crude_symbol].pop(0)
            
            # Get previous candle data if available
            previous_candle = candle_history[crude_symbol][-2] if len(candle_history[crude_symbol]) >= 2 else current_candle
            
            # Check for signals with enhanced detector
            signal = detect_smart_money(symbol_display, current_candle, previous_candle)
            
            if signal:
                # Validate the signal to reduce false signals
                is_valid, passed_checks, total_checks, validation_details = enhanced_signal_validation(
                    crude_symbol, signal, current_candle, candle_history[crude_symbol], current_time
                )
                
                validation_status = "✅ VALIDATED" if is_valid else "❌ REJECTED"
                print(f"🎯 {signal}")
                print(f"   Signal Validation: {validation_status} ({passed_checks}/{total_checks} checks passed)")
                
                # Show validation details
                for check_ok, check_msg in validation_details:
                    status_icon = "✅" if check_ok else "❌"
                    print(f"     {status_icon} {check_msg}")
                
                # Manage position based on VALIDATED signal
                position_action = manage_position(crude_symbol, signal, current_price, is_valid)
                
            else:
                # Show current price and basic info even when no signal
                price_change = ((current_price - current_candle['open']) / current_candle['open'] * 100)
                change_icon = "📈" if price_change > 0 else "📉" if price_change < 0 else "➖"
                print(f"   {symbol_display}: {change_icon} ₹{current_price:.2f} ({price_change:+.2f}%) - No clear signal")
                    
        except Exception as e:
            print(f"❌ Error checking crude oil: {e}")
            print(f"   Trying alternative symbol...")
            # Try with simple CRUDEOIL symbol
            try:
                quote = kite.quote("MCX:CRUDEOIL")
                data = quote["MCX:CRUDEOIL"]
                current_price = data['last_price']
                print(f"   Alternative symbol worked! Price: ₹{current_price:.2f}")
            except:
                print(f"   Alternative symbol also failed. Crude oil data not available.")
        
        # Show active positions after each scan
        show_active_positions()
    
    except Exception as e:
        print(f"❌ API Error: {e}")


def main():
    print("🛢️🚀 Starting Crude Oil Scanner...")
    print("⏰ Will run every 5 minutes during MCX hours (9:00 AM - 11:30 PM)")
    print("📊 Trading: CRUDEOIL Futures")
    print("🛡️  Enhanced false signal protection for commodities")
    print("=" * 60)
    
    if not is_mcx_market_open():
        print("❌ MCX market is currently closed.")
        print("   MCX Trading Hours: 9:00 AM - 11:30 PM")
        return
    
    # Schedule to run every 5 minutes
    schedule.every(5).minutes.do(scan_crude_market)
    
    # Also run immediately
    scan_crude_market()
    
    # Keep running until MCX closes
    while is_mcx_market_open():
        schedule.run_pending()
        time.sleep(1)
    
    # MCX closed - show final summary
    print("\n" + "=" * 60)
    print("🏁 MCX market closed. Crude scanner stopping.")
    show_daily_summary()


if __name__ == "__main__":
    main()