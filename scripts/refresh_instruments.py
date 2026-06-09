#!/usr/bin/env python3
"""Daily refresh of instrument_master from Kite API."""
import asyncio, asyncpg, urllib.request, json
from datetime import date, datetime

async def refresh():
    conn_dyor = await asyncpg.connect("postgresql://dyor_user:DyorSecure2026Mar@127.0.0.1/dyor_db")
    row = await conn_dyor.fetchrow("SELECT value FROM api_settings WHERE key='kite_token'")
    token = json.loads(row["value"])["access_token"]
    await conn_dyor.close()
    
    conn = await asyncpg.connect("postgresql://alphamarket_user:AlphaMkt2026@127.0.0.1/alphamarket_db")
    
    for exchange in ["NFO", "NSE"]:
        url = f"https://api.kite.trade/instruments/{exchange}"
        req = urllib.request.Request(url, headers={"Authorization": f"token wmwpq34kw5th0y2l:{token}"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode()
        
        lines = text.strip().split("\n")
        headers = lines[0].split(",")
        
        await conn.execute(f"DELETE FROM instrument_master WHERE exchange='{exchange}'")
        
        now = datetime.now()
        inserted = 0
        for line in lines[1:]:
            parts = line.split(",")
            if len(parts) < len(headers):
                continue
            d = {headers[i]: parts[i].strip('"') for i in range(len(headers))}
            expiry = d.get("expiry","")
            exp_date = None
            if expiry:
                try: exp_date = date.fromisoformat(expiry)
                except: continue
            elif exchange == "NFO":
                continue
            try:
                await conn.execute("""
                    INSERT INTO instrument_master 
                        (instrument_token, exchange_token, tradingsymbol, name, expiry, strike, 
                         tick_size, lot_size, instrument_type, segment, exchange, last_refreshed)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                    ON CONFLICT DO NOTHING
                """,
                    int(d.get("instrument_token",0)), int(d.get("exchange_token",0)),
                    d.get("tradingsymbol",""), d.get("name",""),
                    exp_date, float(d.get("strike",0)),
                    float(d.get("tick_size",0.05)), int(d.get("lot_size",1)),
                    d.get("instrument_type",""), d.get("segment",""),
                    exchange, now)
                inserted += 1
            except:
                pass
        print(f"[{exchange}] {inserted} instruments loaded")
    
    await conn.close()
    print(f"[{datetime.now()}] instrument_master refreshed")

asyncio.run(refresh())
