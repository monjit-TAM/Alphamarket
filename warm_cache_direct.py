import asyncio, sys, json, time, os
sys.path.insert(0, '/opt/dyor-backend')
os.chdir('/opt/dyor-backend')

async def main():
    import redis.asyncio as aioredis
    import aiohttp
    import numpy as np
    import pandas as pd
    from datetime import date, timedelta

    redis_client = await aioredis.from_url("redis://localhost:6379/0", decode_responses=True)
    print(f"[{time.strftime('%H:%M:%S')}] Redis connected")

    # ── Step 1: Fetch all 923 stocks OHLCV in parallel batches of 30 ──
    print(f"[{time.strftime('%H:%M:%S')}] Fetching OHLCV for all stocks...")

    # Get universe from stock_universe.json
    with open('/opt/alphaforge/stock_universe.json') as f:
        udata = json.load(f)
    universe = udata.get('universe', [])[:923]
    print(f"[{time.strftime('%H:%M:%S')}] Universe: {len(universe)} stocks")

    # Fetch all OHLCV in parallel batches
    all_data = {}
    t0 = time.time()
    async with aiohttp.ClientSession() as session:
        for i in range(0, len(universe), 30):
            batch = universe[i:i+30]
            tasks = []
            for sym in batch:
                tasks.append(session.get(f'http://127.0.0.1:5004/data/equity/ohlcv/{sym}',
                                        timeout=aiohttp.ClientTimeout(total=15)))
            responses = await asyncio.gather(*tasks, return_exceptions=True)
            for sym, resp in zip(batch, responses):
                try:
                    if isinstance(resp, Exception):
                        continue
                    d = await resp.json()
                    rows = d.get('data', [])
                    if rows and len(rows) >= 30:
                        all_data[sym] = rows
                except:
                    pass
            done = min(i+30, len(universe))
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
        large = ['RELIANCE','TCS','HDFCBANK','ICICIBANK','INFY','HDFC','KOTAKBANK','LT','AXISBANK','HINDUNILVR','SBIN','BAJFINANCE','BHARTIARTL','ASIANPAINT','MARUTI','TITAN','SUNPHARMA','ULTRACEMCO','NESTLEIND','WIPRO','ONGC','NTPC','POWERGRID','TATAMOTORS','BAJAJFINSV']
        mid = ['GODREJCP','MCDOWELL-N','PIDILITIND','SIEMENS','BERGEPAINT','HAVELLS','DABUR','MARICO','COLPAL','MPHASIS','LTTS','PERSISTENT','COFORGE']
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

    # Save sb_universe
    await redis_client.set("sb_universe", json.dumps(stocks), ex=43200)
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
        await redis_client.setex(cache_key, 43200, json.dumps(result))
        # Also cache the norm_key format used by dashboard (min=0, max=999999)
        norm_key = f"screener:{strat}:0:999999::::"
        await redis_client.setex(norm_key, 43200, json.dumps(result))
        print(f"[{time.strftime('%H:%M:%S')}] Cached: {strat} ({len(filtered)} matches)")

    print(f"[{time.strftime('%H:%M:%S')}] ALL DONE! {len(strategies)} strategies cached.")
    await redis_client.close()

asyncio.run(main())
