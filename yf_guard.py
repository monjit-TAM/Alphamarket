"""yf_guard.py - stop pointless Yahoo lookups (4 Nov 2026).

Index names were sent to Yahoo as stocks (NIFTY.NS, BANKNIFTY.NS ...) and delisted symbols
(ISEC.NS ...) were looked up again and again; each one is a failed request and an error line.
Index tickers are mapped to Yahoo's real index symbols; delisted symbols get an empty answer
without a network call. Everything else passes through unchanged.
"""
import pandas as _pd
import yfinance as _yf

INDEX = {"NIFTY.NS": "^NSEI", "NIFTY50.NS": "^NSEI", "NIFTY 50.NS": "^NSEI", "BANKNIFTY.NS": "^NSEBANK",
         "FINNIFTY.NS": "NIFTY_FIN_SERVICE.NS", "MIDCPNIFTY.NS": "NIFTY_MID_SELECT.NS",
         "SENSEX.NS": "^BSESN", "INDIAVIX.NS": "^INDIAVIX"}
DEAD = set(['EXCEL.NS', 'ISEC.NS'])


class _Empty:
    def __init__(self, t):
        self.ticker = t
        self.info, self.fast_info, self.news = {}, {}, []
        self.calendar = None

    def history(self, *a, **k):
        return _pd.DataFrame()

    def __getattr__(self, n):
        return None


_T, _D = _yf.Ticker, _yf.download


def _Ticker(t, *a, **k):
    s = str(t).upper()
    if s in DEAD:
        return _Empty(t)
    return _T(INDEX.get(s, t), *a, **k)


def _download(tickers=None, *a, **k):
    lst = tickers.replace(",", " ").split() if isinstance(tickers, str) else list(tickers or [])
    keep = [x for x in lst if str(x).upper() not in DEAD and str(x).upper() not in INDEX]
    if not keep:
        return _pd.DataFrame()
    if len(keep) == len(lst) or len(keep) == 1:
        # nothing to drop, or dropping would change a multi-ticker frame into a single-ticker one
        return _D(tickers, *a, **k)
    return _D(" ".join(keep) if isinstance(tickers, str) else keep, *a, **k)


if not getattr(_yf, "_alphaverse_guard", False):
    _yf.Ticker, _yf.download, _yf._alphaverse_guard = _Ticker, _download, True
