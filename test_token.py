from kiteconnect import KiteConnect

api_key = "tpwjbkqec6xshvau"
access_token = "u6ZcAdyC608Zylq3qJxBHNwzz5bWENoz"

kite = KiteConnect(api_key=api_key)
kite.set_access_token(access_token)

# Try to get your profile - if this works, token is valid
profile = kite.profile()
print(f"✅ Token is VALID! Connected as: {profile['user_name']}")