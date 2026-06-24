"""
Sync F&O flags from instrument_master to nse-symbols.json
Run after instrument_master refresh (daily at 3:15 AM)
"""
import json, psycopg2, subprocess

DB_URL = "postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db"
JSON_FILE = "/var/www/alphamarket/server/data/nse-symbols.json"

def sync():
    conn = psycopg2.connect(DB_URL)
    cr = conn.cursor()
    cr.execute("SELECT DISTINCT name FROM instrument_master WHERE instrument_type IN ('FUT','CE','PE') AND exchange='NFO'")
    fno_stocks = set(r[0] for r in cr.fetchall())
    conn.close()

    with open(JSON_FILE) as f:
        symbols = json.load(f)

    added = removed = 0
    for s in symbols:
        was_fno = s.get('isFnO', False)
        is_fno = s['symbol'] in fno_stocks
        if is_fno and not was_fno:
            s['isFnO'] = True
            added += 1
        elif not is_fno and was_fno:
            s['isFnO'] = False
            removed += 1

    with open(JSON_FILE, 'w') as f:
        json.dump(symbols, f, indent=2)

    fno_total = sum(1 for s in symbols if s.get('isFnO'))
    print(f'F&O sync: {added} added, {removed} removed, {fno_total} total')

    if added > 0 or removed > 0:
        print('Rebuilding AlphaMarket...')
        subprocess.run(['npm', 'run', 'build'], cwd='/var/www/alphamarket', capture_output=True)
        subprocess.run(['pm2', 'restart', 'alphamarket'], capture_output=True)
        print('Done')
    else:
        print('No changes')

if __name__ == '__main__':
    sync()
