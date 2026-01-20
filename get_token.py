from kiteconnect import KiteConnect

# Your API details
api_key = "tpwjbkqec6xshvau"  # Your API key
api_secret = "ipku54f5br2gc75e1qxrpxfp5f3a71n6"  # Your API secret (get from Zerodha console)
request_token = "FpEGwpjR2SCGnMFPig50JCGICqdA5EKb"  # The request token you just got

# Generate session
kite = KiteConnect(api_key=api_key)

# Generate access token
data = kite.generate_session(request_token, api_secret=api_secret)

# This is your permanent access token!
access_token = data["access_token"]
print(f"✅ Your ACCESS TOKEN: {access_token}")
print("Save this token for your market_scanner.py file!")