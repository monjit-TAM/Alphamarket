"""
Market Cap Classification Builder — uses individual fundamentals endpoint
SEBI/AMFI standard classification
"""
import json, asyncio, httpx, redis, os
from datetime import datetime

AF_BASE = "http://127.0.0.1:5004"
UNIVERSE_FILE = "/opt/alphaforge/stock_universe.json"

LARGE_CAP_MIN = 20000
MID_CAP_MIN = 5000
SMALL_CAP_MIN = 1000

ASM_GSM_SYMBOLS = {
    "YESBANK","IDEA","SUZLON","JPASSOCIAT","JPPOWER","RCOM",
    "RPOWER","DHFL","UNITECH","IBREALEST","PCJEWELLER",
    "GTLINFRA","GAMMONIND","HDIL","GVKPIL","JAIPRAKASH",
}

def classify(mcap_cr):
    if mcap_cr >= LARGE_CAP_MIN: return "large"
    if mcap_cr >= MID_CAP_MIN: return "mid"
    if mcap_cr >= SMALL_CAP_MIN: return "small"
    return "micro"

async def fetch_one(client, sem, sym, results):
    async with sem:
        try:
            r = await client.get(f"{AF_BASE}/data/equity/fundamentals/{sym}", timeout=10)
            if r.status_code == 200:
                d = r.json()
                mc = d.get("market_cap")
                if mc and mc > 0:
                    results[sym] = mc
        except:
            pass

async def build():
    print(f"[MCap] Start {datetime.now().isoformat()}")
    with open(UNIVERSE_FILE) as f:
        universe = json.load(f).get("universe", [])
    print(f"[MCap] {len(universe)} symbols")

    results = {}
    sem = asyncio.Semaphore(10)  # 10 concurrent
    async with httpx.AsyncClient(timeout=15) as client:
        tasks = [fetch_one(client, sem, sym, results) for sym in universe]
        done = 0
        for batch_start in range(0, len(tasks), 100):
            batch = tasks[batch_start:batch_start+100]
            await asyncio.gather(*batch)
            done += len(batch)
            print(f"  Progress: {done}/{len(universe)} ({len(results)} mcaps)")

    print(f"[MCap] Got {len(results)}/{len(universe)} market caps")

    classifications = {}
    counts = {"large":0,"mid":0,"small":0,"micro":0,"unknown":0}
    for sym in universe:
        mc = results.get(sym)
        if mc and mc > 0:
            mc_cr = mc / 1e7
            seg = classify(mc_cr)
            classifications[sym] = {"cap_segment":seg,"market_cap_cr":round(mc_cr,1),"is_asm_gsm":sym in ASM_GSM_SYMBOLS}
            counts[seg] += 1
        else:
            classifications[sym] = {"cap_segment":"unknown","market_cap_cr":0,"is_asm_gsm":sym in ASM_GSM_SYMBOLS}
            counts["unknown"] += 1

    r = redis.Redis()
    cache = {"classifications":classifications,"counts":counts,"asm_gsm_list":list(ASM_GSM_SYMBOLS),
             "thresholds":{"large":LARGE_CAP_MIN,"mid":MID_CAP_MIN,"small":SMALL_CAP_MIN},
             "updated_at":datetime.now().isoformat(),"total":len(universe)}
    r.set("mcap_classifications", json.dumps(cache), ex=86400)
    r.close()

    print(f"[MCap] Done:")
    for k,v in counts.items(): print(f"  {k}: {v}")
    print(f"  ASM/GSM: {sum(1 for v in classifications.values() if v['is_asm_gsm'])}")

if __name__ == "__main__":
    asyncio.run(build())
