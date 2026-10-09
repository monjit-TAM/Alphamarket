import asyncio, sys, json, time, os
sys.path.insert(0, '/opt/dyor-backend')
os.chdir('/opt/dyor-backend')

async def main():
    import redis.asyncio as aioredis
    import aiohttp
    import numpy as np
    import pandas as pd
    from datetime import date, timedelta

    redis_client = await aioredis.from_url("redis://localhost:6379/1", decode_responses=True)
    print(f"[{time.strftime('%H:%M:%S')}] Redis connected")

    # ── Step 1: Fetch all 923 stocks OHLCV in parallel batches of 30 ──
    print(f"[{time.strftime('%H:%M:%S')}] Fetching OHLCV for all stocks...")

    # Get universe from stock_universe.json
    with open('/opt/alphaforge/stock_universe.json') as f:
        udata = json.load(f)
    universe = udata.get('universe', [])[:923]
    print(f"[{time.strftime('%H:%M:%S')}] Universe: {len(universe)} stocks")

    # Extend with every Alpha Fundamentals company >= Rs 1,000 Cr. The static list had gone
    # stale (68 of the top 250 by market cap were absent, incl. TVSMOTOR, PFC, SWIGGY).
    try:
        import urllib.request
        _af = json.load(urllib.request.urlopen(
            "http://127.0.0.1:5015/api/fundamentals/screen?limit=5000", timeout=90)).get("data", [])
        _seen, _added = set(universe), 0
        for _r in _af:
            _s = (_r.get("symbol") or "").upper()
            try:
                _mc = float(_r.get("market_cap") or 0)
            except (TypeError, ValueError):
                _mc = 0
            if _s and _s not in _seen and _mc >= 1000:
                universe.append(_s)
                _seen.add(_s)
                _added += 1
        print(f"[{time.strftime('%H:%M:%S')}] Universe extended with {_added} Alpha Fundamentals companies >= Rs 1,000 Cr: {len(universe)} total")
    except Exception as _e:
        print(f"[{time.strftime('%H:%M:%S')}] Universe extension skipped: {_e}")

    # Fetch all OHLCV from Alpha Fundamentals (localhost:5015) in bulk batches of 50
    all_data = {}
    t0 = time.time()
    async with aiohttp.ClientSession() as session:
        for i in range(0, len(universe), 50):
            batch = universe[i:i+50]
            # URL-encode each symbol: a raw '&' (M&M, GVT&D) ended the query parameter and
            # silently dropped the rest of the batch, incl. RELIANCE, HDFCBANK, SBIN.
            import urllib.parse
            syms_param = ",".join(urllib.parse.quote(s, safe="") for s in batch)
            try:
                resp = await session.get(
                    f'http://localhost:5015/api/fundamentals/prices/bulk?symbols={syms_param}&days=400',
                    timeout=aiohttp.ClientTimeout(total=30))
                d = await resp.json()
                if d.get('success') and d.get('data'):
                    batch_matched = 0
                    for sym, rows in d['data'].items():
                        if rows and len(rows) >= 30:
                            normalized = []
                            for r in rows:
                                try:
                                    o = float(r.get('open') or 0)
                                    h = float(r.get('high') or 0)
                                    l = float(r.get('low') or 0)
                                    cl = float(r.get('close') or 0)
                                    v = int(float(r.get('volume') or 0))
                                    if cl > 0:
                                        normalized.append({'date': r.get('trade_date', r.get('date', '')), 'open': o, 'high': h, 'low': l, 'close': cl, 'volume': v})
                                except (ValueError, TypeError):
                                    pass
                            all_data[sym] = normalized
            except Exception as e:
                print(f"[{time.strftime('%H:%M:%S')}] Batch error at {i}: {e}")
                print(f"[{time.strftime('%H:%M:%S')}] Failed batch symbols: {batch[:5]}...")
            else:
                    print(f"[{time.strftime('%H:%M:%S')}] Batch {i}-{i+50}: API returned success={d.get('success')}, data keys={len(d.get('data',{}))}")
            done = min(i+50, len(universe))
            print(f"[{time.strftime('%H:%M:%S')}] {done}/{len(universe)} stocks fetched ({len(all_data)} with data)")

    print(f"[{time.strftime('%H:%M:%S')}] Fetch complete: {len(all_data)} stocks in {time.time()-t0:.1f}s")

    # ── Step 2: Compute indicators for all stocks ──
    print(f"[{time.strftime('%H:%M:%S')}] Computing indicators...")

    def sf(v, d=0):
        try:
            v = float(v)
            return d if (np.isnan(v) or np.isinf(v)) else v
        except:
            return d

    # Sector maps
    sector_map = {}
    industry_map = {}
    try:
        with open('/opt/alphaforge/stock_universe.json') as f:
            ud = json.load(f)
        for s in ud.get('stocks', []):
            sym = s.get('symbol','')
            sector_map[sym] = s.get('sector', 'Other')
            industry_map[sym] = s.get('industry', 'Other')
    except:
        pass

    def get_cap(sym):
        # Simple cap classification
        large = ['RELIANCE','TCS','HDFCBANK','ICICIBANK','INFY','HDFC','KOTAKBANK','LT','AXISBANK','HINDUNILVR',
                 'SBIN','BAJFINANCE','BHARTIARTL','ASIANPAINT','MARUTI','TITAN','SUNPHARMA','ULTRACEMCO',
                 'NESTLEIND','WIPRO','ONGC','NTPC','POWERGRID','TATAMOTORS','BAJAJFINSV','HCLTECH','TECHM',
                 'DRREDDY','CIPLA','GRASIM','DIVISLAB','ADANIENT','ADANIPORTS','ADANIGREEN','COALINDIA',
                 'BPCL','IOC','HEROMOTOCO','EICHERMOT','TATACONSUM','BRITANNIA','GODREJCP','ITC','APOLLOHOSP',
                 'JSWSTEEL','TATASTEEL','HINDALCO','VEDL','INDUSINDBK','BANKBARODA','CANBK','PNB','RECLTD',
                 'PFC','NHPC','IRFC','HAL','BEL','BHEL','IRCTC','ZOMATO','PAYTM','DELHIVERY','NYKAA',
                 'POLICYBZR','DLF','LODHA','TRENT','MANKIND','MAXHEALTH','PIIND','SHRIRAMFIN','CHOLAFIN',
                 'MUTHOOTFIN','BAJAJ-AUTO','M&M','BOSCHLTD','ABB','SIEMENS','HAVELLS','VOLTAS','TORNTPHARM',
                 'LUPIN','AUROPHARMA','BIOCON','LICI','SBILIFE','HDFCLIFE','ICICIPRULI','ICICIGI','SBICARD',
                 'INDUSTOWER','TATAPOWER','ADANIPOWER','JSWENERGY','CUMMINSIND','TATAELXSI','LTIM','PERSISTENT',
                 'COFORGE','MPHASIS']
        mid = ['PIDILITIND','BERGEPAINT','DABUR','MARICO','COLPAL','LTTS','ASTRAL','ATUL','DEEPAKNTR',
               'PAGEIND','RELAXO','BATAINDIA','VBL','RAJESHEXPO','METROPOLIS','DMART','POLYCAB',
               'KPITTECH','SONACOMS','KAYNES','CLEAN','HAPPSTMNDS','ROUTE','LATENTVIEW','MAPMYINDIA',
               'ZYDUSLIFE','GLENMARK','IPCALAB','LAURUSLABS','NATCOPHARM','ALKEM','AJANTPHARM',
               'FEDERALBNK','IDFCFIRSTB','BANDHANBNK','RBLBANK','MANAPPURAM','LICHSGFIN','CANFINHOME',
               'SRF','AARTI','SUMICHEM','SUDARSCHEM','FINEORG','CARBORUNIV','GRINDWELL','TIMKEN',
               'SCHAEFFLER','SKFINDIA','THERMAX','AIAENG','CGPOWER','RATNAMANI','APLAPOLLO','STARHEALTH',
               'NIACL','GICRE','OBEROIRLTY','PRESTIGE','BRIGADE','SOBHA','PHOENIXLTD','CROMPTON',
               'WHIRLPOOL','BLUESTARCO','AMBER','DIXON','HONAUT','3MINDIA','GILLETTE','PGHH']
        if sym in large: return 'large'
        if sym in mid: return 'mid'
        return 'small'

    stocks = []
    for sym, rows in all_data.items():
        try:
            df = pd.DataFrame(rows)
            df.columns = [c.lower() for c in df.columns]
            df = df.sort_values('date').tail(400)
            c = df['close'].astype(float)
            h = df['high'].astype(float)
            l = df['low'].astype(float)
            v = df['volume'].astype(float)
            if len(c) < 30: continue
            price = float(c.iloc[-1])
            prev = float(c.iloc[-2])
            change_pct = sf((price-prev)/prev*100)
            vol = int(v.iloc[-1])
            vol_avg = int(v.rolling(20).mean().iloc[-1]) if len(v)>=20 else int(v.mean())
            vol_ratio = sf(vol/vol_avg, 1.0) if vol_avg>0 else 1.0
            delta = c.diff()
            gain = delta.clip(lower=0).ewm(span=14,adjust=False).mean()
            loss = (-delta.clip(upper=0)).ewm(span=14,adjust=False).mean()
            rs = gain.iloc[-1]/loss.iloc[-1] if sf(loss.iloc[-1])!=0 else 0
            rsi = sf(100-100/(1+rs), 50)
            sma_50 = sf(c.rolling(50).mean().iloc[-1])
            sma_200 = sf(c.rolling(200).mean().iloc[-1]) if len(c)>=200 else sf(c.mean())
            c_252 = c.iloc[-min(252,len(c)):]
            w52_high = sf(c_252.max())
            w52_low = sf(c_252.min())
            pct_from_52h = sf((price-w52_high)/w52_high*100) if w52_high>0 else 0
            pct_from_52l = sf((price-w52_low)/w52_low*100) if w52_low>0 else 0
            bb_mid = c.rolling(20).mean()
            bb_std = c.rolling(20).std()
            bb_upper = sf((bb_mid+2*bb_std).iloc[-1])
            bb_lower = sf((bb_mid-2*bb_std).iloc[-1])
            bb_width = sf((bb_upper-bb_lower)/sf(bb_mid.iloc[-1],1)*100) if sf(bb_mid.iloc[-1])>0 else 0
            ema12 = c.ewm(span=12,adjust=False).mean()
            ema26 = c.ewm(span=26,adjust=False).mean()
            macd_line = ema12-ema26
            macd_sig = macd_line.ewm(span=9,adjust=False).mean()
            macd_hist = sf((macd_line-macd_sig).iloc[-1])
            macd_cross_up = bool(sf(macd_line.iloc[-1])>sf(macd_sig.iloc[-1]) and sf(macd_line.iloc[-2])<=sf(macd_sig.iloc[-2]))
            rs_1m = sf(c.iloc[-1]/c.iloc[-22]-1,0)*100 if len(c)>=22 and sf(c.iloc[-22])>0 else change_pct
            rs_3m = sf(c.iloc[-1]/c.iloc[-60]-1,0)*100 if len(c)>=60 and sf(c.iloc[-60])>0 else change_pct
            tr = pd.concat([h-l,(h-df['close'].shift(1)).abs(),(l-df['close'].shift(1)).abs()],axis=1).max(axis=1)
            atr = tr.rolling(10).mean()
            st_lower = (h+l)/2-3*atr
            above_supertrend = bool(price>sf(st_lower.iloc[-1])) if len(atr.dropna())>0 else bool(price>sma_200)
            above_200dma = bool(price>sma_200)
            above_50dma = bool(price>sma_50)
            gap_pct = sf((float(df['open'].iloc[-1])-prev)/prev*100) if prev>0 else 0
            wk_change = sf((price/sf(c.iloc[-6],price)-1)*100) if len(c)>=6 else change_pct
            minervini_score = sum([
                bool(price>sf(c.rolling(150).mean().iloc[-1])) if len(c)>=150 else False,
                above_200dma, above_50dma, bool(sma_50>sma_200),
                bool(pct_from_52l>=25), bool(pct_from_52h>=-25),
            ])
            stocks.append({
                "symbol":sym,"name":sym,"sector":sector_map.get(sym,'Other'),
                "industry":industry_map.get(sym,'Other'),"cap_segment":get_cap(sym),
                "price":round(price,2),"prev_close":round(prev,2),
                "change_pct":round(change_pct,2),"change":round(change_pct,2),
                "volume":vol,"vol_ratio":round(vol_ratio,2),
                "rsi":round(rsi,1),"macd_hist":round(macd_hist,3),
                "macd_cross_up":macd_cross_up,
                "sma_50":round(sma_50,2),"sma_200":round(sma_200,2),
                "w52_high":round(w52_high,2),"w52_low":round(w52_low,2),
                "pct_from_52h":round(pct_from_52h,1),"pct_from_52l":round(pct_from_52l,1),
                "gap_pct":round(gap_pct,2),"bb_width":round(bb_width,2),
                "bb_upper":round(bb_upper,2),"bb_lower":round(bb_lower,2),
                "above_200dma":above_200dma,"above_50dma":above_50dma,
                "above_supertrend":above_supertrend,
                "rs_1m":round(rs_1m,1),"rs_3m":round(rs_3m,1),
                "wk_change":round(wk_change,2),"minervini_score":minervini_score,
                "pe_ratio":0,"roe":0,"dividend_yield":0,"debt_equity":0,"market_cap":0,
                "alpha_rating":0,"momentum_score":0,"fundamental_score":0,
                "accumulation_score":0,"trend_score":0,"sentiment_score":0,
            })
        except Exception as e:
            continue

    print(f"[{time.strftime('%H:%M:%S')}] Computed {len(stocks)} stocks")

    # ── Step 2b: Enrich from Alpha Fundamentals (real fundamentals + market-wide cap rank) ──
    # Previously every fundamental was written as a literal 0 and cap_segment came from a
    # hand-typed list. Alpha Fundamentals (port 5015) has nightly TrueData ratios for ~2,300 cos.
    def _num(v):
        try:
            x = float(v)
            return None if (np.isnan(x) or np.isinf(x)) else x
        except (TypeError, ValueError):
            return None

    def _bounded(v, lo, hi):
        x = _num(v)
        return x if (x is not None and lo <= x <= hi) else None

    fund_rows = {}
    try:
        async with aiohttp.ClientSession() as fsess:
            async with fsess.get("http://127.0.0.1:5015/api/fundamentals/screen?limit=5000",
                                 timeout=aiohttp.ClientTimeout(total=90)) as resp:
                payload = await resp.json()
        rows = payload.get("data", []) if isinstance(payload, dict) else []
        # Exclude implausible market caps from ranking. Shares and market cap can be wrong
        # together (ASTRON: 4.65 trillion shares), so test turnover against market cap instead.
        def _mcap_ok(r):
            mc = _num(r.get("market_cap")) or 0
            if mc <= 0:
                return False
            hi, lo = _num(r.get("high_52w")), _num(r.get("low_52w"))
            if not hi or not lo:
                return True
            px = (hi + lo) / 2
            turnover_ratio = (_num(r.get("avg_volume")) or 0) * px / (mc * 1e7)
            # A sub-Rs 50 price with a lakh-crore cap is only plausible if it trades like one (IDEA does)
            if px < 50 and mc > 100000 and turnover_ratio < 1e-3:
                return False
            return turnover_ratio >= 2e-5

        ranked = sorted((r for r in rows if _mcap_ok(r)),
                        key=lambda r: _num(r.get("market_cap")), reverse=True)
        _suspect = sum(1 for r in rows if (_num(r.get("market_cap")) or 0) > 0 and not _mcap_ok(r))
        print(f"[{time.strftime('%H:%M:%S')}] Market caps excluded from ranking as implausible: {_suspect}")
        for rank, r in enumerate(ranked, 1):
            r["_mcap_rank"] = rank
        fund_rows = {(r.get("symbol") or "").upper(): r for r in rows}
        print(f"[{time.strftime('%H:%M:%S')}] Alpha Fundamentals: {len(fund_rows)} companies, {len(ranked)} ranked by market cap")
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] Alpha Fundamentals fetch failed, keeping legacy fields: {e}")

    enriched_count = 0
    for s in stocks:
        r = fund_rows.get(s["symbol"].upper())
        if not r:
            s["fundamentals_source"] = "none"
            continue
        pe = _bounded(r.get("pe_ttm"), 0.01, 300)
        roe = _bounded(r.get("roe"), -100, 100)
        de = _bounded(r.get("debt_to_equity"), 0, 20)
        dy = _bounded(r.get("dividend_yield"), 0, 25)
        pb = _bounded(r.get("pb_ratio"), 0.01, 100)
        mcap = _num(r.get("market_cap")) or 0
        avg_vol = _num(r.get("avg_volume")) or 0
        rank = r.get("_mcap_rank")
        s["mcap_suspect"] = rank is None and (_num(r.get("market_cap")) or 0) > 0
        s["pe_ratio"] = round(pe, 2) if pe is not None else 0
        s["pe_valid"] = pe is not None
        s["roe"] = round(roe, 2) if roe is not None else 0
        s["debt_equity"] = round(de, 2) if de is not None else 0
        s["de_available"] = de is not None
        s["dividend_yield"] = round(dy, 2) if dy is not None else 0
        s["pb"] = round(pb, 2) if pb is not None else 0
        s["market_cap"] = round(mcap, 2)
        s["mcap_rank"] = rank
        s["avg_volume"] = round(avg_vol)
        s["avg_turnover_cr"] = round(avg_vol * s["price"] / 1e7, 2)
        for out_key, src_key in (("roce", "roce"), ("net_margin", "net_margin"), ("ebitda_margin", "ebitda_margin"),
                                 ("earnings_yield", "earnings_yield"), ("beta", "beta"),
                                 ("promoter_holding", "promoter_holding"), ("revenue_growth_yoy", "revenue_growth_yoy"),
                                 ("eps_growth_yoy", "eps_growth_yoy"), ("pat_growth_yoy", "pat_growth_yoy")):
            v = _num(r.get(src_key))
            s[out_key] = round(v, 2) if v is not None else None
        if r.get("company_name"):
            s["name"] = r["company_name"]
        s["fund_sector"] = r.get("sector")
        s["fund_industry"] = r.get("industry")
        if s.get("sector") in (None, "", "Other") and r.get("sector"):
            s["sector"] = r["sector"]
        if s.get("industry") in (None, "", "Other") and r.get("industry"):
            s["industry"] = r["industry"]
        # AMFI convention: top 100 by market cap = large, 101-250 = mid, rest = small
        if rank:
            s["cap_segment"] = "large" if rank <= 100 else "mid" if rank <= 250 else "small"
        s["fundamentals_source"] = "alpha_fundamentals"
        enriched_count += 1
    print(f"[{time.strftime('%H:%M:%S')}] Enriched {enriched_count}/{len(stocks)} stocks from Alpha Fundamentals")

    # ── Step 2c: Sector rotation (RRG) and benchmark sector weights, on our own data ──
    # Benchmark = top 500 by market cap, cap-weighted (Nifty 500 proxy). Sectors = NSE macro-
    # sectors from Alpha Fundamentals, the same taxonomy the portfolio-gap layer uses.
    # Approximation: historical levels use today's cap weights, not point-in-time weights.
    try:
        members = [s for s in stocks if s.get("mcap_rank") and s["mcap_rank"] <= 500
                   and s.get("fund_sector") and s["symbol"] in all_data]
        total_mcap = sum(s["market_cap"] for s in members) or 1
        sector_weights = {}
        for s in members:
            sector_weights[s["fund_sector"]] = sector_weights.get(s["fund_sector"], 0) + s["market_cap"] / total_mcap * 100

        closes = {}
        for s in members:
            ser = pd.Series({r["date"]: r["close"] for r in all_data[s["symbol"]] if r.get("date")})
            ser.index = pd.to_datetime(ser.index)
            closes[s["symbol"]] = ser.sort_index()
        px_df = pd.DataFrame(closes).sort_index().ffill(limit=3)
        rets = px_df.pct_change()
        caps = pd.Series({s["symbol"]: s["market_cap"] for s in members})

        def _cap_weighted_index(cols):
            r = rets[cols]
            w = caps[cols]
            weighted = r.mul(w, axis=1).sum(axis=1)
            available = r.notna().mul(w, axis=1).sum(axis=1).replace(0, np.nan)
            return (1 + (weighted / available).fillna(0)).cumprod()

        bench_wk = _cap_weighted_index(list(px_df.columns)).resample("W-FRI").last()
        WINDOW, TRAIL = 10, 12
        by_sector = {}
        for s in members:
            by_sector.setdefault(s["fund_sector"], []).append(s["symbol"])

        rrg_rows = []
        for sector, cols in by_sector.items():
            if len(cols) < 5:
                continue
            raw = 100 * _cap_weighted_index(cols).resample("W-FRI").last() / bench_wk
            ratio = 100 + (raw - raw.rolling(WINDOW).mean()) / raw.rolling(WINDOW).std().replace(0, np.nan) * 2
            mom_raw = ratio.diff(1)
            momentum = 100 + (mom_raw - mom_raw.rolling(WINDOW).mean()) / mom_raw.rolling(WINDOW).std().replace(0, np.nan) * 2
            both = pd.concat([ratio, momentum], axis=1, keys=["r", "m"]).replace([np.inf, -np.inf], np.nan).dropna().tail(TRAIL)
            if both.empty:
                continue
            r_now, m_now = float(both["r"].iloc[-1]), float(both["m"].iloc[-1])
            quadrant = ("Leading" if r_now >= 100 and m_now >= 100 else
                        "Weakening" if r_now >= 100 else
                        "Lagging" if m_now < 100 else "Improving")
            rrg_rows.append({
                "sector": sector, "quadrant": quadrant, "members": len(cols),
                "rs_ratio": round(r_now, 2), "rs_momentum": round(m_now, 2),
                "benchmark_weight": round(sector_weights.get(sector, 0), 2),
                "trail": [{"week": d.strftime("%Y-%m-%d"), "rs_ratio": round(float(v["r"]), 2),
                           "rs_momentum": round(float(v["m"]), 2)} for d, v in both.iterrows()],
            })

        asof = time.strftime("%Y-%m-%d")
        await redis_client.set("af_sector_rrg", json.dumps({
            "asof": asof, "benchmark": "Top-500 by market cap, cap-weighted (Nifty 500 proxy)",
            "window_weeks": WINDOW, "trail_weeks": TRAIL, "sectors": rrg_rows}), ex=259200)
        await redis_client.set("af_benchmark_sector_weights", json.dumps({
            "asof": asof, "members": len(members),
            "weights": {k: round(v, 2) for k, v in sorted(sector_weights.items(), key=lambda kv: -kv[1])}}), ex=259200)
        print(f"[{time.strftime('%H:%M:%S')}] Sector RRG cached: " + ", ".join(
            f"{x['sector']}={x['quadrant']}" for x in sorted(rrg_rows, key=lambda x: x["quadrant"])))
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] Sector RRG failed: {e}")

    # Save sb_universe
    # Enrich with F&O flag
    try:
        fno_set = set(s["symbol"] for s in json.load(open("/var/www/alphamarket/server/data/nse-symbols.json")) if s.get("isFnO"))
        for s in stocks:
            if s["symbol"] in fno_set:
                s["is_fno"] = True
    except: pass
    await redis_client.set("sb_universe", json.dumps(stocks), ex=43200)
    await redis_client.set("sb_universe_enriched", json.dumps(stocks), ex=43200)
    print(f"[{time.strftime('%H:%M:%S')}] sb_universe_enriched cached ({len(stocks)} stocks)")
    print(f"[{time.strftime('%H:%M:%S')}] sb_universe cached ({len(stocks)} stocks)")

    # ── Step 3: Cache all 34 screener strategies ──
    strategies = {
        "momentum": lambda s: s["change_pct"]>1 and s["vol_ratio"]>1.5 and s["rsi"]>50,
        "oversold": lambda s: s["rsi"]<35,
        "overbought": lambda s: s["rsi"]>70,
        "volume": lambda s: s["vol_ratio"]>3,
        "breakout": lambda s: s["pct_from_52h"]>-3 and s["vol_ratio"]>2,
        "52w_high": lambda s: s["pct_from_52h"]>-2,
        "52w_low": lambda s: s["pct_from_52l"]<5,
        "golden_cross": lambda s: s["above_200dma"] and s["above_50dma"] and s["sma_50"]>s["sma_200"],
        "death_cross": lambda s: not s["above_200dma"] and not s["above_50dma"],
        "gap_up": lambda s: s["gap_pct"]>2,
        "gap_down": lambda s: s["gap_pct"]<-2,
        "up_on_volume": lambda s: s["change_pct"]>0 and s["vol_ratio"]>2,
        "bb_squeeze": lambda s: s["bb_width"]<10,
        "macd_crossover": lambda s: s["macd_cross_up"],
        "minervini": lambda s: s["minervini_score"]>=5,
        "relative_strength": lambda s: s["rs_3m"]>15 and s["rs_1m"]>5,
        "recent_breakout": lambda s: s["pct_from_52h"]>-5 and s["vol_ratio"]>1.5,
        "pullback_buy": lambda s: s["above_200dma"] and s["rsi"]<45 and s["pct_from_52h"]<-10,
        "top_losers": lambda s: s["change_pct"]<-2,
        "near_support": lambda s: s["pct_from_52l"]<10 and s["above_200dma"],
        "trend_strong": lambda s: s["above_supertrend"] and s["above_200dma"] and s["rsi"]>55,
        "high_beta": lambda s: abs(s["rs_1m"])>10,
        "range_breakout": lambda s: s["bb_width"]>30 and s["vol_ratio"]>1.5,
        "volume_dry": lambda s: s["vol_ratio"]<0.4,
        "macd_bearish": lambda s: not s["macd_cross_up"] and s["macd_hist"]<0,
        "supertrend_buy": lambda s: s["above_supertrend"],
        "growth_momentum": lambda s: s["rs_3m"]>10 and s["above_200dma"],
        "safe_haven": lambda s: s["above_200dma"] and s["rsi"]<60 and s["vol_ratio"]<1.5,
        "turnaround": lambda s: s["rs_1m"]>5 and s["pct_from_52l"]<20 and not s["above_200dma"],
        "sector_rotation": lambda s: s["rs_1m"]>3 and s["rs_3m"]<0,
        "multi_timeframe": lambda s: s["above_200dma"] and s["above_50dma"] and s["rsi"]>50 and s["change_pct"]>0 and s["rs_1m"]>0 and s["rs_3m"]>0,
        "dividend_yield": lambda s: True,
        "low_pe": lambda s: True,
        "high_roe": lambda s: True,
    }

    today = date.today().isoformat()
    for strat, fn in strategies.items():
        filtered = sorted([s for s in stocks if fn(s)], key=lambda x: x.get("change_pct",0), reverse=True)
        result = {"stocks":filtered[:50],"count":len(filtered),"strategy":strat,
                  "as_of":today,"universe_size":len(universe),"scanned":len(stocks),"cached":True}
        cache_key = f"screener:{strat}:50:10000::::"
        dated_key = f"screener:{__import__('datetime').date.today().isoformat()}:{strat}:50:10000::::"
        await redis_client.setex(cache_key, 43200, json.dumps(result))
        await redis_client.setex(dated_key, 43200, json.dumps(result))
        # Also cache the norm_key format used by dashboard (min=0, max=999999)
        norm_key = f"screener:{strat}:0:999999::::"
        dated_norm_key = f"screener:{__import__('datetime').date.today().isoformat()}:{strat}:0:999999::::"
        await redis_client.setex(norm_key, 43200, json.dumps(result))
        await redis_client.setex(dated_norm_key, 43200, json.dumps(result))
        alt_key = f"screener:{strat}:0:999999::::"
        data_json = json.dumps(result)
        await redis_client.setex(cache_key, 43200, data_json)
        await redis_client.setex(alt_key, 43200, data_json)
        print(f"[{time.strftime('%H:%M:%S')}] Cached: {strat} ({len(filtered)} matches)")

    print(f"[{time.strftime('%H:%M:%S')}] ALL DONE! {len(strategies)} strategies cached.")
    await redis_client.close()

asyncio.run(main())
