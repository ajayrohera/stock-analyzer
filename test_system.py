from smart_detector import detect_smart_money
import pandas as pd
from datetime import datetime

# Test with yesterday's data for RELIANCE and INFY
test_data = {
    'RELIANCE': [
        {'time': '09:15', 'buy_quantity': 100000, 'sell_quantity': 80000, 'volume': 500000, 'average_volume': 300000, 'price_change': 0.1},
        {'time': '10:30', 'buy_quantity': 150000, 'sell_quantity': 90000, 'volume': 800000, 'average_volume': 300000, 'price_change': 0.2},
        {'time': '13:45', 'buy_quantity': 70000, 'sell_quantity': 120000, 'volume': 600000, 'average_volume': 300000, 'price_change': -0.1},
    ],
    'INFY': [
        {'time': '09:30', 'buy_quantity': 80000, 'sell_quantity': 120000, 'volume': 400000, 'average_volume': 250000, 'price_change': 0.4},
        {'time': '11:15', 'buy_quantity': 120000, 'sell_quantity': 80000, 'volume': 550000, 'average_volume': 250000, 'price_change': 0.1},
        {'time': '14:30', 'buy_quantity': 90000, 'sell_quantity': 90000, 'volume': 350000, 'average_volume': 250000, 'price_change': 0.0},
    ]
}

print("🔍 TESTING SMART MONEY DETECTOR...")
print("=" * 50)

for stock, data_points in test_data.items():
    print(f"\n📊 Testing {stock}:")
    for data in data_points:
        result = detect_smart_money(stock, data)
        if result:
            print(f"   {data['time']} - {result}")
        else:
            print(f"   {data['time']} - No signal")