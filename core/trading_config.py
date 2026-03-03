"""
Production Trading Configuration — Lot Sizes, Margins, Risk Rules
"""

# NSE F&O Lot Sizes (as of Mar 2026 — update quarterly)
FNO_LOT_SIZES = {
    "RELIANCE": 250, "TCS": 175, "HDFCBANK": 550, "INFY": 300, "ICICIBANK": 700,
    "HINDUNILVR": 300, "ITC": 1600, "SBIN": 750, "BHARTIARTL": 475, "KOTAKBANK": 400,
    "LT": 150, "AXISBANK": 600, "BAJFINANCE": 125, "MARUTI": 50, "HCLTECH": 350,
    "ASIANPAINT": 300, "TITAN": 225, "SUNPHARMA": 350, "WIPRO": 1500, "TATAMOTORS": 575,
    "POWERGRID": 2700, "NTPC": 2925, "ULTRACEMCO": 100, "NESTLEIND": 25, "TATASTEEL": 5500,
    "JSWSTEEL": 675, "INDUSINDBK": 450, "ADANIENT": 250, "ADANIPORTS": 500, "BAJAJFINSV": 75,
    "TECHM": 600, "GRASIM": 475, "ONGC": 3850, "COALINDIA": 2100, "HEROMOTOCO": 150,
    "DRREDDY": 125, "EICHERMOT": 150, "CIPLA": 650, "DIVISLAB": 200, "BPCL": 1800,
    "APOLLOHOSP": 125, "TATACONSUM": 900, "SBILIFE": 375, "HDFCLIFE": 1100, "BRITANNIA": 200,
    "HINDALCO": 1075, "M&M": 350, "BAJAJ-AUTO": 125, "VEDL": 1550, "BANKBARODA": 2925,
    "CANBK": 6750, "PNB": 6000, "IDFCFIRSTB": 7500, "FEDERALBNK": 5000, "LICHSGFIN": 1100,
    "VOLTAS": 500, "PIDILITIND": 250, "HAVELLS": 500, "GODREJCP": 500, "DABUR": 1250,
    "MARICO": 800, "COLPAL": 350, "BERGEPAINT": 600, "PAGEIND": 15, "INDIGO": 300,
    "TRENT": 125, "ZOMATO": 2000, "IDEA": 50000, "SAIL": 4850, "NMDC": 3350,
    "GAIL": 6100, "IOC": 4875, "RECLTD": 1500, "PFC": 1500, "BHEL": 5250,
    "BEL": 3300, "HAL": 150, "IRCTC": 575, "TATAPOWER": 2700, "AMBUJACEM": 1000,
    "ACC": 300, "SHREECEM": 25, "MFSL": 500, "CHOLAFIN": 500, "MANAPPURAM": 3000,
    "MUTHOOTFIN": 400, "SBICARD": 800, "AUBANK": 500, "BANDHANBNK": 2400,
    "INDUSTOWER": 2300, "TATACOMM": 250, "PERSISTENT": 150, "LTTS": 150, "COFORGE": 100,
    "MPHASIS": 175, "NATIONALUM": 4000, "HINDZINC": 2200, "JINDALSTEL": 500,
    "AUROPHARMA": 500, "BIOCON": 2250, "LUPIN": 425, "TORNTPHARM": 250,
    "ALKEM": 150, "LALPATHLAB": 250, "POLYCAB": 125, "SIEMENS": 125,
    "ABB": 125, "DIXON": 100, "DLF": 825, "GODREJPROP": 325, "LODHA": 500,
    "MOTHERSON": 5100, "MRF": 5, "APOLLOTYRE": 1700, "ASHOKLEY": 2900,
    "TVSMOTOR": 175, "BATAINDIA": 450, "JUBLFOOD": 1250, "IRFC": 5000, "NHPC": 7500,
}

# SPAN Margin % by segment (approximate, varies by stock)
MARGIN_RATES = {
    "equity_delivery": 1.0,      # 100% — full payment
    "equity_intraday": 0.20,     # 20% — 5x leverage
    "futures": 0.15,             # 15% SPAN + exposure
    "options_buy": 1.0,          # Premium only
    "options_sell": 0.20,        # ~20% SPAN
}

# Transaction costs (discount broker — Zerodha/Groww)
COSTS = {
    "brokerage_pct": 0.0003,     # 0.03% or ₹20 cap per order
    "brokerage_cap": 20,         # ₹20 per executed order
    "stt_delivery_buy": 0.001,   # 0.1%
    "stt_delivery_sell": 0.001,  # 0.1%
    "stt_intraday_sell": 0.000250, # 0.025%
    "stt_futures_sell": 0.000125,  # 0.0125%
    "stt_options_sell": 0.000625,  # 0.0625%
    "exchange_nse": 0.0000345,
    "exchange_bse": 0.0000345,
    "gst_rate": 0.18,
    "stamp_buy": 0.00015,       # Delivery
    "stamp_intraday": 0.00003,  # Intraday
    "stamp_futures": 0.00002,
    "sebi_charges": 0.000001,
}

# Risk management defaults
RISK_RULES = {
    # Position sizing
    "max_capital_per_trade_pct": 5.0,    # Max 5% of capital per trade
    "max_positions": 10,                  # Max simultaneous positions
    "max_sector_exposure_pct": 20.0,     # Max 20% in one sector
    "max_single_stock_pct": 10.0,        # Max 10% in one stock

    # Daily limits
    "daily_loss_limit_pct": 2.0,         # Stop trading after 2% drawdown
    "daily_profit_target_pct": 3.0,      # Consider stopping at 3% profit
    "max_trades_per_day_jobbing": 50,
    "max_trades_per_day_scalping": 15,
    "max_trades_per_day_arbitrage": 5,

    # Per-trade limits
    "jobbing_stop_loss_pct": 0.10,
    "jobbing_target_pct": 0.05,
    "jobbing_max_hold_minutes": 5,

    "scalping_stop_loss_pct": 0.30,
    "scalping_target_pct": 0.50,
    "scalping_max_hold_minutes": 30,

    "arbitrage_min_annualized_pct": 8.0,
    "arbitrage_min_basis_pct": 0.05,
    "arbitrage_max_days_to_expiry": 30,
}

# Rollover analysis: typical costs
ROLLOVER = {
    "spread_cost_pct": 0.03,    # Typical roll cost
    "slippage_pct": 0.02,       # Execution slippage
    "best_rollover_window_days": 3,  # Roll 3 days before expiry
}

# Trading time windows
TRADING_WINDOWS = {
    "market_open": "09:15",
    "market_close": "15:30",
    "jobbing_window_1": ("09:15", "10:00"),  # Opening volatility
    "jobbing_window_2": ("14:30", "15:15"),  # Closing volatility
    "scalping_window_1": ("09:30", "11:00"), # Trend establishment
    "scalping_window_2": ("14:00", "15:00"), # Afternoon momentum
    "avoid_window": ("12:00", "13:30"),      # Low volume lull
    "expiry_day_caution": True,              # Reduce size on expiry Thursdays
}

# Sector mapping for correlation checks
SECTOR_MAP = {
    "BANKING": ["HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK", "KOTAKBANK", "BANKBARODA", "PNB", "CANBK", "IDFCFIRSTB", "FEDERALBNK", "INDUSINDBK", "AUBANK", "BANDHANBNK"],
    "IT": ["TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "PERSISTENT", "LTTS", "COFORGE", "MPHASIS"],
    "AUTO": ["TATAMOTORS", "MARUTI", "BAJAJ-AUTO", "HEROMOTOCO", "EICHERMOT", "M&M", "ASHOKLEY", "TVSMOTOR"],
    "PHARMA": ["SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB", "AUROPHARMA", "BIOCON", "LUPIN", "TORNTPHARM", "ALKEM"],
    "METAL": ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "SAIL", "NMDC", "NATIONALUM", "HINDZINC", "JINDALSTEL"],
    "ENERGY": ["RELIANCE", "ONGC", "BPCL", "IOC", "GAIL", "NTPC", "POWERGRID", "TATAPOWER", "COALINDIA", "NHPC"],
    "FMCG": ["HINDUNILVR", "ITC", "NESTLEIND", "BRITANNIA", "DABUR", "MARICO", "COLPAL", "GODREJCP", "TATACONSUM"],
    "INFRA": ["LT", "ADANIENT", "ADANIPORTS", "DLF", "GODREJPROP", "LODHA"],
    "FINANCIAL": ["BAJFINANCE", "BAJAJFINSV", "SBILIFE", "HDFCLIFE", "MFSL", "CHOLAFIN", "MUTHOOTFIN", "SBICARD", "LICHSGFIN"],
    "TELECOM": ["BHARTIARTL", "IDEA", "INDUSTOWER", "TATACOMM"],
}

def get_lot_size(symbol):
    return FNO_LOT_SIZES.get(symbol, 1)

def get_sector(symbol):
    for sector, stocks in SECTOR_MAP.items():
        if symbol in stocks:
            return sector
    return "OTHER"

def calculate_costs(price, qty, trade_type="intraday"):
    """Calculate exact transaction costs"""
    turnover = price * qty
    brokerage = min(turnover * COSTS["brokerage_pct"], COSTS["brokerage_cap"])

    if trade_type == "delivery":
        stt = turnover * COSTS["stt_delivery_sell"]
        stamp = turnover * COSTS["stamp_buy"]
    elif trade_type == "futures":
        stt = turnover * COSTS["stt_futures_sell"]
        stamp = turnover * COSTS["stamp_futures"]
    elif trade_type == "options":
        stt = turnover * COSTS["stt_options_sell"]
        stamp = turnover * COSTS["stamp_futures"]
    else:  # intraday
        stt = turnover * COSTS["stt_intraday_sell"]
        stamp = turnover * COSTS["stamp_intraday"]

    exchange = turnover * COSTS["exchange_nse"]
    gst = (brokerage + exchange) * COSTS["gst_rate"]
    sebi = turnover * COSTS["sebi_charges"]

    total = brokerage + stt + exchange + gst + stamp + sebi
    return {
        "brokerage": round(brokerage, 2),
        "stt": round(stt, 2),
        "exchange": round(exchange, 2),
        "gst": round(gst, 2),
        "stamp": round(stamp, 2),
        "sebi": round(sebi, 2),
        "total": round(total, 2),
        "pct_of_turnover": round((total / turnover) * 100, 4) if turnover > 0 else 0,
    }

def check_position_risk(symbol, price, qty, capital, existing_positions=None):
    """Check if a trade passes risk management rules"""
    existing_positions = existing_positions or []
    trade_value = price * qty
    rules = RISK_RULES
    warnings = []
    blocks = []

    # Check capital allocation
    pct_of_capital = (trade_value / capital) * 100 if capital > 0 else 100
    if pct_of_capital > rules["max_capital_per_trade_pct"]:
        blocks.append(f"Trade uses {pct_of_capital:.1f}% of capital (max {rules['max_capital_per_trade_pct']}%)")

    # Check position count
    if len(existing_positions) >= rules["max_positions"]:
        blocks.append(f"Max positions ({rules['max_positions']}) already reached")

    # Check sector concentration
    sector = get_sector(symbol)
    sector_exposure = sum(p["value"] for p in existing_positions if get_sector(p["symbol"]) == sector)
    new_sector_pct = ((sector_exposure + trade_value) / capital) * 100 if capital > 0 else 100
    if new_sector_pct > rules["max_sector_exposure_pct"]:
        warnings.append(f"Sector {sector} exposure would be {new_sector_pct:.1f}% (limit {rules['max_sector_exposure_pct']}%)")

    # Check single stock concentration
    stock_exposure = sum(p["value"] for p in existing_positions if p["symbol"] == symbol)
    new_stock_pct = ((stock_exposure + trade_value) / capital) * 100 if capital > 0 else 100
    if new_stock_pct > rules["max_single_stock_pct"]:
        warnings.append(f"{symbol} exposure would be {new_stock_pct:.1f}% (limit {rules['max_single_stock_pct']}%)")

    # Check correlation (same sector count)
    same_sector = [p for p in existing_positions if get_sector(p["symbol"]) == sector]
    if len(same_sector) >= 3:
        warnings.append(f"Already {len(same_sector)} positions in {sector} sector — high correlation risk")

    return {
        "allowed": len(blocks) == 0,
        "blocks": blocks,
        "warnings": warnings,
        "trade_pct_of_capital": round(pct_of_capital, 2),
        "sector": sector,
    }
