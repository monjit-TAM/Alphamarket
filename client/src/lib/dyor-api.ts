const DYOR_API = '/dyor/api';

async function dyorFetch<T = any>(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${DYOR_API}${endpoint}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers as any },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const dyorApi = {
  me: () => dyorFetch('/auth/me'),
  searchSymbols: (q: string) => dyorFetch(`/symbols/search?q=${encodeURIComponent(q)}`),
  allSymbols: () => dyorFetch('/symbols/all'),
  stockPrice: (symbol: string) => dyorFetch(`/symbols/price/${symbol}`),
  stockFundamentals: (symbol: string) => dyorFetch(`/stock/fundamentals/${symbol}`),
  stockChart: (symbol: string) => dyorFetch(`/chart/${symbol}`),
  screener: (strategy?: string) => dyorFetch(`/screener${strategy ? `?strategy=${strategy}` : ''}`),
  watchlist: () => dyorFetch('/watchlist'),
  watchlistPrices: () => dyorFetch('/watchlist/prices'),
  addToWatchlist: (symbol: string) => dyorFetch(`/watchlist/add/${symbol}`, { method: 'POST' }),
  removeFromWatchlist: (symbol: string) => dyorFetch(`/watchlist/remove/${symbol}`, { method: 'DELETE' }),
  runBacktest: (params: any) => dyorFetch('/backtest/run', { method: 'POST', body: JSON.stringify({ name: params.name || params.symbol + ' ' + params.strategy, initial_capital: params.initial_capital || 100000, ...params }) }),
  backtests: () => dyorFetch('/backtests'),
  backtest: (id: number) => dyorFetch(`/backtest/${id}`),
  paperTrades: () => dyorFetch('/paper-trades'),
  openPaperTrade: (params: any) => dyorFetch('/paper-trade/open', { method: 'POST', body: JSON.stringify(params) }),
  closePaperTrade: (id: number, exitPrice: number) => dyorFetch(`/paper-trade/${id}/close?exit_price=${exitPrice}`, { method: 'POST' }),
  forwardTests: () => dyorFetch('/forward-tests'),
  createForwardTest: (params: any) => dyorFetch('/forward-test/create', { method: 'POST', body: JSON.stringify({ name: params.name || params.strategy + ' Forward Test', initial_capital: params.initial_capital || 100000, ...params }) }),
  forwardTest: (id: number) => dyorFetch(`/forward-test/${id}`),
  scanForwardTest: (id: number) => dyorFetch(`/forward-test/${id}/scan`, { method: 'POST' }),
  pauseForwardTest: (id: number) => dyorFetch(`/forward-test/${id}/pause`, { method: 'POST' }),
  resumeForwardTest: (id: number) => dyorFetch(`/forward-test/${id}/resume`, { method: 'POST' }),
  modelPortfolios: () => dyorFetch('/model-portfolios'),
  modelPortfolioTemplates: () => dyorFetch('/model-portfolios/templates'),
  createModelPortfolio: (params: any) => dyorFetch('/model-portfolio/create', { method: 'POST', body: JSON.stringify(params) }),
  sectors: () => dyorFetch('/sectors'),
  sectorRotation: () => dyorFetch('/sector-rotation'),
  sectorRrg: () => dyorFetch('/sector-rrg'),
  optionsChain: (symbol: string) => dyorFetch(`/options/chain/${symbol}`),
  optionsPayoff: (params: any) => dyorFetch('/options/payoff', { method: 'POST', body: JSON.stringify(params) }),
  optionsGreeks: (params: any) => dyorFetch('/options/greeks', { method: 'POST', body: JSON.stringify(params) }),
  optionsStrategies: () => dyorFetch('/options/strategies'),
  alerts: () => dyorFetch('/alerts'),
  createAlert: (params: any) => dyorFetch('/alerts/create', { method: 'POST', body: JSON.stringify(params) }),
  toggleAlert: (id: number) => dyorFetch(`/alerts/${id}/toggle`, { method: 'POST' }),
  indicators: (params: any) => dyorFetch('/indicators', { method: 'POST', body: JSON.stringify(params) }),
};
