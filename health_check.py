#!/usr/bin/env python3
"""
DYOR Data Health Monitor — runs every hour via cron
Checks: Groww token, data service, price freshness, all API endpoints
Logs issues and optionally sends email alerts
"""
import sys, json, time, smtplib, subprocess
from datetime import datetime
from email.mime.text import MIMEText
from urllib.request import urlopen, Request
from urllib.error import URLError

LOG_FILE = "/var/log/dyor-health.log"
ALERT_EMAIL = "hello@alphamarket.co.in"
DATA_SVC = "http://127.0.0.1:5004"
DYOR_API = "http://127.0.0.1:8001"
AM_API = "http://127.0.0.1:5001"

def log(msg, level="INFO"):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

def fetch(url, timeout=15):
    try:
        req = Request(url)
        resp = urlopen(req, timeout=timeout)
        return json.loads(resp.read().decode())
    except Exception as e:
        return {"_error": str(e)}

def check_service(name, url):
    """Check if a service is responding"""
    d = fetch(url)
    if "_error" in d:
        return False, f"{name} DOWN: {d['_error']}"
    return True, f"{name} OK"

def check_groww_token():
    """Check Groww token is valid and not expired"""
    d = fetch(f"{AM_API}/api/shared/token/groww?secret=alphamarket-shared-2026")
    if "_error" in d:
        # Try with header
        try:
            req = Request(f"{AM_API}/api/shared/token/groww")
            req.add_header("x-shared-secret", "alphamarket-shared-2026")
            resp = urlopen(req, timeout=10)
            d = json.loads(resp.read().decode())
        except Exception as e:
            return False, f"Groww token fetch failed: {e}"
    
    token = d.get("token", "")
    if not token:
        return False, "No Groww token found"
    
    expiry = d.get("expiry", 0)
    if expiry:
        now_ms = int(time.time() * 1000)
        remaining_hrs = (expiry - now_ms) / 3600000
        if remaining_hrs < 2:
            return False, f"Groww token expiring in {remaining_hrs:.1f} hours!"
        return True, f"Groww token valid ({remaining_hrs:.0f}h remaining)"
    return True, "Groww token present"

def check_prices():
    """Check if major stocks return live Groww prices"""
    test_stocks = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN"]
    issues = []
    ok = 0
    for sym in test_stocks:
        d = fetch(f"{DATA_SVC}/data/equity/quote/{sym}")
        if "_error" in d:
            issues.append(f"{sym}: fetch failed")
            continue
        price = d.get("price", 0)
        source = d.get("source", "unknown")
        if price == 0:
            issues.append(f"{sym}: price=0")
        elif source != "groww":
            issues.append(f"{sym}: using {source} (not Groww)")
        else:
            ok += 1
    
    if issues:
        return False, f"Price issues ({ok}/{len(test_stocks)} OK): {'; '.join(issues)}"
    return True, f"All {len(test_stocks)} stock prices from Groww"

def check_fundamentals():
    """Check if fundamentals data is available"""
    d = fetch(f"{DATA_SVC}/data/equity/fundamentals/RELIANCE")
    if "_error" in d:
        return False, f"Fundamentals fetch failed: {d['_error']}"
    eps = d.get("eps", 0)
    pe = d.get("pe_trailing", 0)
    bv = d.get("book_value", 0)
    if not eps or not pe:
        return False, f"Fundamentals incomplete: EPS={eps}, PE={pe}, BV={bv}"
    return True, f"Fundamentals OK: EPS={eps}, PE={pe}, BV={bv}"

def check_redis():
    """Check Redis connectivity"""
    try:
        result = subprocess.run(["redis-cli", "ping"], capture_output=True, text=True, timeout=5)
        if "PONG" in result.stdout:
            return True, "Redis OK"
        return False, f"Redis not responding: {result.stdout}"
    except Exception as e:
        return False, f"Redis check failed: {e}"

def check_db():
    """Check PostgreSQL connectivity"""
    try:
        result = subprocess.run(
            ["psql", "postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db", 
             "-c", "SELECT COUNT(*) FROM users;"],
            capture_output=True, text=True, timeout=10
        )
        if "row" in result.stdout:
            return True, "Database OK"
        return False, f"DB query failed: {result.stderr[:100]}"
    except Exception as e:
        return False, f"DB check failed: {e}"

def check_index_fno():
    """Check if index F&O data is accessible"""
    for idx in ["NIFTY", "BANKNIFTY"]:
        d = fetch(f"{DATA_SVC}/data/equity/quote/{idx}")
        if "_error" not in d and d.get("price", 0) > 0:
            continue
        # Try Groww direct
        return False, f"Index {idx} quote not available"
    return True, "Index quotes (NIFTY, BANKNIFTY) OK"

def send_alert(subject, body):
    """Send email alert if critical issues found"""
    try:
        msg = MIMEText(body)
        msg["Subject"] = f"[DYOR Health Alert] {subject}"
        msg["From"] = "dyor-monitor@alphamarket.co.in"
        msg["To"] = ALERT_EMAIL
        # Try local sendmail
        p = subprocess.Popen(["/usr/sbin/sendmail", "-t"], stdin=subprocess.PIPE)
        p.communicate(msg.as_bytes())
        log(f"Alert email sent: {subject}")
    except Exception as e:
        log(f"Could not send alert email: {e}", "WARN")

def main():
    log("=" * 60)
    log("DYOR DATA HEALTH CHECK STARTED")
    
    checks = [
        ("Redis", check_redis),
        ("Database", check_db),
        ("Groww Token", check_groww_token),
        ("Live Prices", check_prices),
        ("Fundamentals", check_fundamentals),
        ("Index F&O", check_index_fno),
    ]
    
    # Also check services are running
    services = [
        ("Data Service (5004)", f"{DATA_SVC}/data/equity/quote/RELIANCE"),
        ("AlphaMarket (5001)", f"{AM_API}/api/shared/token/groww?secret=alphamarket-shared-2026"),
    ]
    
    critical_issues = []
    warnings = []
    
    for name, url in services:
        ok, msg = check_service(name, url)
        log(f"  {'✓' if ok else '✗'} {msg}", "INFO" if ok else "ERROR")
        if not ok:
            critical_issues.append(msg)
    
    for name, check_fn in checks:
        try:
            ok, msg = check_fn()
            log(f"  {'✓' if ok else '✗'} {msg}", "INFO" if ok else "WARN")
            if not ok:
                if name in ("Redis", "Database", "Groww Token"):
                    critical_issues.append(msg)
                else:
                    warnings.append(msg)
        except Exception as e:
            log(f"  ✗ {name} check exception: {e}", "ERROR")
            critical_issues.append(f"{name}: {e}")
    
    # Auto-fix: flush stale caches if prices are from Yahoo
    d = fetch(f"{DATA_SVC}/data/equity/quote/RELIANCE")
    if d.get("source") == "yahoo":
        log("  ⚠ Prices falling back to Yahoo — flushing cache to retry Groww")
        subprocess.run(["redis-cli", "-n", "1", "FLUSHDB"], capture_output=True)
        warnings.append("Auto-flushed cache due to Yahoo fallback")
    
    # Summary
    log("-" * 40)
    if critical_issues:
        log(f"CRITICAL ISSUES: {len(critical_issues)}", "ERROR")
        for issue in critical_issues:
            log(f"  ❌ {issue}", "ERROR")
        send_alert(
            f"{len(critical_issues)} Critical Issues",
            f"DYOR Health Check found critical issues at {datetime.now()}:\n\n" +
            "\n".join(f"❌ {i}" for i in critical_issues) +
            ("\n\nWarnings:\n" + "\n".join(f"⚠ {w}" for w in warnings) if warnings else "")
        )
    elif warnings:
        log(f"WARNINGS: {len(warnings)}", "WARN")
        for w in warnings:
            log(f"  ⚠ {w}", "WARN")
    else:
        log("ALL CHECKS PASSED ✓", "INFO")
    
    log("HEALTH CHECK COMPLETE")
    log("=" * 60)
    
    # Return exit code for cron
    sys.exit(1 if critical_issues else 0)

if __name__ == "__main__":
    main()
