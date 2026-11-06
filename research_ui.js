/* DYOR research panels: Models, Base Rates, Stock Research.
   Loaded by /var/www/dyor.html from /dyor/api/research/ui.js. Data comes from /dyor/api/research/*,
   which reads the same data service AlphaLab uses. Models is advisor-only (the backend enforces it;
   signal_lock.js shows the lock card). */
(function () {
  if (window.__rxLoaded) return;
  window.__rxLoaded = true;
  var API = '/dyor/api/research/';
  var FAM = {
    composite: ['Composite', '#0f4c5c', '#e6f0f2'], quality: ['Quality', '#1d4ed8', '#e8eefc'],
    growth: ['Growth', '#15803d', '#e7f5ec'], momentum: ['Momentum', '#7c3aed', '#f1eafd'], value: ['Value', '#c2410c', '#fcefe7']
  };
  var FAM_ORDER = ['composite', 'quality', 'growth', 'momentum', 'value'];
  var FIELD = {
    roce: 'Return on capital employed', roe: 'Return on equity', debt_to_equity: 'Debt to equity', pb_ratio: 'Price to book',
    ev_ebitda: 'EV / EBITDA', peg_ratio: 'PEG ratio', fcf_yield: 'Free cash flow yield', earnings_yield: 'Earnings yield',
    dividend_yield: 'Dividend yield', revenue_growth_yoy: 'Revenue growth (YoY)', revenue_cagr_3y: 'Revenue CAGR (3y)',
    earnings_cagr_3y: 'Earnings CAGR (3y)', cons_revenue: 'Revenue consistency', cons_margin: 'Margin consistency',
    trend_revenue: 'Revenue trend', trend_margin: 'Margin trend', trend_roce: 'ROCE trend', trend_interest_burden: 'Interest burden trend',
    accel_revenue: 'Revenue acceleration', accel_eps: 'EPS acceleration', ret_6m_rel: '6-month return vs market',
    ret_12m_rel: '12-month return vs market', momentum_quality: 'Steadiness of the move', volume_trend: 'Volume trend',
    pct_from_52w_high: 'Distance from 52-week high', margin_vs_trough: 'Margin vs trough', pe_vs_own_history: 'P/E vs own history',
    composite_quality: 'Best quality-model score', composite_growth: 'Best growth-model score',
    composite_momentum: 'Best momentum-model score', composite_value: 'Best value-model score'
  };
  var GATE = {
    quarters_min: function (v) { return 'At least ' + v + ' quarters of filed results'; },
    positive_pat: function () { return 'Profitable in the latest trailing twelve months'; },
    interest_coverage_min: function (v) { return 'Interest coverage of at least ' + v + 'x'; },
    min_turnover_cr: function (v) { return 'Average daily turnover of at least ₹' + v + ' cr'; },
    margin_recovery_min: function (v) { return 'Margin at least ' + Math.round((Number(v) - 1) * 100) + '% above its trough'; },
    debt_to_equity_max: function (v) { return 'Debt to equity no higher than ' + v; },
    roce_min: function (v) { return 'ROCE of at least ' + v + '%'; }, roe_min: function (v) { return 'ROE of at least ' + v + '%'; },
    market_cap_min_cr: function (v) { return 'Market cap of at least ₹' + v + ' cr'; },
    pe_max: function (v) { return 'P/E no higher than ' + v; }, pb_max: function (v) { return 'Price to book no higher than ' + v; }
  };
  var GREEN = '#15803d', ORANGE = '#c2410c', TEAL = '#0f4c5c';

  /* ── helpers ── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { var x = typeof v === 'string' ? parseFloat(v) : v; return typeof x === 'number' && isFinite(x) ? x : null; }
  function pick(o) { if (!o) return null; for (var i = 1; i < arguments.length; i++) { var v = o[arguments[i]]; if (v !== undefined && v !== null && v !== '') return v; } return null; }
  function inr(v) { v = n(v); return v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: v < 100 ? 2 : 1 }); }
  function pct(v, dp) { v = n(v); if (dp == null) dp = 1; if (v == null) return '—'; var r = Number(v.toFixed(dp)) || 0; return (r > 0 ? '+' : '') + r.toFixed(dp) + '%'; }
  function plain(v, dp) { v = n(v); if (dp == null) dp = 1; return v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: dp }); }
  function tone(v) { v = n(v); return v == null ? 'var(--text3)' : v >= 0 ? GREEN : ORANGE; }
  function fmtDate(s) { if (!s) return '—'; var d = new Date(s); return isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  var EXTRA = { pe_ttm: 'P/E (TTM)', pe: 'P/E', pb: 'P/B', symbol: 'Symbol', company_name: 'Company', market_cap: 'Market cap (₹ cr)', ebitda_margin: 'EBITDA margin',
    net_margin: 'Net margin', eps_ttm: 'EPS (TTM)', pat_growth_yoy: 'Profit growth (YoY)', interest_coverage: 'Interest cover', period_end: 'Quarter' };
  function label(f) { var s = FIELD[f] || EXTRA[f] || String(f).replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
  function get(path) {
    return fetch(API + path, { credentials: 'include' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error((d && d.detail) || ('HTTP ' + r.status)); e.status = r.status; e.locked = d && d.locked; throw e; }
        return d;
      });
    });
  }
  function loading(t) { return '<div class="rx-muted" style="padding:20px 0">' + esc(t || 'Loading…') + '</div>'; }
  function errBox(e) {
    if (e && e.locked) return '';           // the lock card explains it
    return '<div class="rx-err">Could not load: ' + esc(e && e.message || e) + '</div>';
  }
  function chip(text, fg, bg) { return '<span class="rx-chip" style="color:' + fg + ';background:' + bg + '">' + esc(text) + '</span>'; }

  /* ── styles ── */
  var css = '' +
    '.rx-wrap{max-width:1200px}.rx-muted{color:var(--text3);font-size:12.5px}.rx-lead{font-size:13px;color:var(--text2);max-width:860px;line-height:1.6;margin:4px 0 16px}' +
    '.rx-err{font-size:13px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 12px;margin:10px 0}' +
    '.rx-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}' +
    '.rx-card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}' +
    '.rx-click{cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit}.rx-click:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}' +
    '.rx-chip{font-size:10.5px;padding:2px 8px;border-radius:10px;font-weight:600;white-space:nowrap}' +
    '.rx-h2{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:22px 0 10px}' +
    '.rx-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin:14px 0 16px;flex-wrap:wrap}' +
    '.rx-tab{background:none;border:none;border-bottom:2px solid transparent;padding:8px 14px;font-size:13px;color:var(--text3);cursor:pointer;margin-bottom:-1px}' +
    '.rx-tab.on{border-bottom-color:' + TEAL + ';color:' + TEAL + ';font-weight:600}' +
    '.rx-seg{display:inline-flex;gap:4px;flex-wrap:wrap}.rx-seg button{padding:5px 12px;border:1px solid var(--border);border-radius:5px;background:var(--bg2);font-size:12px;cursor:pointer;color:var(--text2)}' +
    '.rx-seg button.on{background:' + TEAL + ';border-color:' + TEAL + ';color:#fff}' +
    '.rx-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.rx-tbl th{font-size:11px;color:var(--text3);font-weight:600;text-align:right;padding:7px 8px;border-bottom:1px solid var(--border);white-space:nowrap}' +
    '.rx-tbl td{padding:7px 8px;border-top:1px solid var(--border);text-align:right;font-variant-numeric:tabular-nums}.rx-tbl th:first-child,.rx-tbl td:first-child{text-align:left}' +
    '.rx-tbl tr.rx-row{cursor:pointer}.rx-tbl tr.rx-row:hover td{background:var(--bg1)}.rx-dim td{color:var(--text3)}' +
    '.rx-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg2)}' +
    '.rx-lv{background:var(--bg1);border-radius:6px;padding:8px}.rx-lv .t{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3)}.rx-lv .v{font-weight:700;color:var(--text1)}' +
    '.rx-back{background:none;border:none;color:' + TEAL + ';font-size:13px;cursor:pointer;padding:0;margin-bottom:12px}' +
    '.rx-in{padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg1);color:var(--text);text-transform:uppercase;width:180px}' +
    '.rx-go{padding:8px 16px;border-radius:6px;border:none;background:' + TEAL + ';color:#fff;font-weight:600;font-size:12.5px;cursor:pointer}' +
    '.rx-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}' +
    '.rx-note{font-size:11.5px;color:var(--text3);line-height:1.6;max-width:900px;margin-top:14px}' +
    '.rx-flag{font-size:12.5px;padding:8px 10px;border-radius:6px;margin:6px 0;line-height:1.5}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ── menu and panels ── */
  var PANELS = [['rmodels', 'Models'], ['baserates', 'Base Rates'], ['stockresearch', 'Stock Research']];
  function install() {
    var anchor = document.getElementById('ng-portfolio');
    var host = document.getElementById('p-emerging');
    if (!anchor || !host || document.getElementById('ng-research')) return !!document.getElementById('ng-research');
    var g = document.createElement('div');
    g.className = 'nav-group'; g.id = 'ng-research';
    g.innerHTML = '<div class="nav-group-header" onclick="toggleNavGroup(\'ng-research\')">RESEARCH <span class="nav-arrow">&#9654;</span></div>' +
      '<div class="nav-group-items">' + PANELS.map(function (p) {
        return '<button class="nbtn" onclick="nav(\'' + p[0] + '\',this)">' + p[1] + '</button>';
      }).join('') + '</div>';
    anchor.parentNode.insertBefore(g, anchor);
    PANELS.forEach(function (p) {
      var el = document.createElement('div');
      el.id = 'p-' + p[0]; el.className = 'panel';
      el.innerHTML = '<div class="rx-wrap" id="rx-' + p[0] + '"></div>';
      host.parentNode.appendChild(el);
    });
    if (window.__sigMarkMenu) window.__sigMarkMenu();
    return true;
  }

  var loaded = {};
  function wrapNav() {
    var orig = window.nav;
    if (typeof orig !== 'function' || orig.__rx) return;
    var w = function (p, btn) {
      var r = orig.apply(this, arguments);
      if (p === 'rmodels' || p === 'baserates' || p === 'stockresearch') {
        var panel = document.getElementById('p-' + p);
        if (panel && panel.querySelector('.sig-lock-card')) return r;
        if (!loaded[p]) { loaded[p] = true; ({ rmodels: modelsHome, baserates: brHome, stockresearch: srHome })[p](); }
      }
      return r;
    };
    w.__rx = true;
    window.nav = w;
  }

  function box(id) { return document.getElementById('rx-' + id); }

  /* ════════════════════ MODELS ════════════════════ */
  var M = { list: null, key: null, tab: 'holdings', d: null };
  function modelsHome() {
    var el = box('rmodels');
    M.key = null;
    el.innerHTML = '<h2 style="margin:0">Models</h2><p class="rx-lead">Ten rules-based stock selection models. Each scores the listed universe on a fixed set of ' +
      'fundamental and technical factors, applies eligibility gates, and admits a name only when its price is inside the buy zone. ' +
      'Every holding carries 1, 3, 6 and 12-month targets and stops, and a research note.</p><div id="rx-mlist">' + loading('Loading models…') + '</div>' + modelsDisclaimer();
    get('models/list').then(function (d) {
      M.list = (d && (d.models || d.items)) || (Array.isArray(d) ? d : []);
      var h = '';
      FAM_ORDER.concat(['other']).forEach(function (f) {
        var items = M.list.filter(function (m) { var fam = String(m.family || '').toLowerCase(); return f === 'other' ? FAM_ORDER.indexOf(fam) < 0 : fam === f; });
        if (!items.length) return;
        var fm = FAM[f] || ['Other', TEAL, '#f3f4f6'];
        h += '<div class="rx-h2" style="color:' + fm[1] + '">' + fm[0] + '</div><div class="rx-grid">';
        items.forEach(function (m) {
          h += '<button class="rx-card rx-click" style="border-top:3px solid ' + fm[1] + '" onclick="window.__rxModel(\'' + esc(m.key) + '\')">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><b style="font-size:14.5px;color:var(--text1)">' + esc(m.name || m.key) + '</b>' + chip(fm[0], fm[1], fm[2]) + '</div>' +
            '<div style="font-size:12.5px;color:var(--text2);margin-top:6px;line-height:1.5">' + esc(m.tagline || m.thesis || '') + '</div>' +
            '<div class="rx-muted" style="margin-top:10px"><b style="color:var(--text1)">' + esc(pick(m, 'live', 'holdings_count') == null ? '—' : pick(m, 'live', 'holdings_count')) + '</b> of ' + esc(m.target || '—') + ' holdings' +
            (m.last_added ? ' · last added ' + fmtDate(m.last_added) : '') + '</div></button>';
        });
        h += '</div>';
      });
      if (d && d.note) h += '<p class="rx-note">' + esc(d.note) + '</p>';
      document.getElementById('rx-mlist').innerHTML = h || '<div class="empty">No models published.</div>';
    }).catch(function (e) { document.getElementById('rx-mlist').innerHTML = errBox(e); });
  }
  function modelsDisclaimer() {
    return '<p class="rx-note">Model portfolios are generated by systematic rules from reported financials and exchange price data, for research purposes. ' +
      'They are not a recommendation to buy or sell any security and do not account for an individual\'s financial situation. Past performance does not guarantee future results.</p>';
  }
  window.__rxModel = function (key) {
    var el = box('rmodels');
    M.key = key; M.tab = 'holdings'; M.d = null;
    el.innerHTML = '<button class="rx-back" onclick="window.__rxModelsHome()">← All models</button><div id="rx-mdet">' + loading() + '</div>';
    get('models/' + encodeURIComponent(key)).then(function (d) { M.d = d; renderModel(); })
      .catch(function (e) { document.getElementById('rx-mdet').innerHTML = errBox(e); });
  };
  window.__rxModelsHome = function () { modelsHome(); };
  window.__rxMTab = function (t) { M.tab = t; renderModel(); };
  function renderModel() {
    var d = M.d, meta = d.model || d, fm = FAM[String(meta.family || '').toLowerCase()] || ['', TEAL, '#f3f4f6'];
    var hold = d.holdings || (d.positions && d.positions.open) || [];
    var past = d.past || d.past_positions || d.closed || (d.positions && d.positions.closed) || [];
    var rs = hold.map(function (h) { return n(pick(h, 'return_pct', 'pnl_pct')); }).filter(function (x) { return x != null; });
    var avg = rs.length ? rs.reduce(function (a, b) { return a + b; }, 0) / rs.length : null;
    var h = '<div class="rx-card" style="border-left:4px solid ' + fm[1] + ';display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap">' +
      '<div style="max-width:780px">' + (fm[0] ? chip(fm[0], fm[1], fm[2]) : '') + '<h2 style="margin:8px 0 6px;color:' + TEAL + '">' + esc(meta.name || M.key) + '</h2>' +
      '<div style="font-size:13px;color:var(--text2);line-height:1.6">' + esc(meta.thesis || '') + '</div></div>' +
      (avg != null ? '<div style="text-align:right"><div class="rx-muted">Open positions</div><div style="font-size:20px;font-weight:700">' + rs.length + '</div>' +
        '<div class="rx-muted" style="margin-top:4px">Average return</div><div style="font-size:17px;font-weight:700;color:' + tone(avg) + '">' + pct(avg) + '</div>' +
        '<div class="rx-muted">' + rs.filter(function (x) { return x > 0; }).length + ' of ' + rs.length + ' in profit</div></div>' : '') + '</div>';
    h += '<div class="rx-tabs">' + [['holdings', 'Holdings (' + hold.length + ')'], ['past', 'Past (' + past.length + ')'], ['method', 'How it selects']].map(function (t) {
      return '<button class="rx-tab' + (M.tab === t[0] ? ' on' : '') + '" onclick="window.__rxMTab(\'' + t[0] + '\')">' + t[1] + '</button>';
    }).join('') + '</div>';
    if (M.tab === 'holdings') h += hold.length ? '<div class="rx-grid" style="grid-template-columns:repeat(auto-fill,minmax(460px,1fr))">' + hold.map(holdingCard).join('') + '</div>'
      : '<div class="empty">No open positions. The model admits a name only when its price is inside the buy zone, so it can sit partly in cash.</div>';
    if (M.tab === 'past') h += past.length ? pastTable(past) : '<div class="empty">No closed positions yet.</div>';
    if (M.tab === 'method') h += methodology(d, meta);
    document.getElementById('rx-mdet').innerHTML = h + modelsDisclaimer();
  }
  function holdingCard(hd) {
    var cmp = n(pick(hd, 'current_price', 'price')), entry = n(pick(hd, 'added_price', 'entry_price'));
    var ret = n(pick(hd, 'return_pct')); if (ret == null && cmp && entry) ret = (cmp / entry - 1) * 100;
    var z = hd.buy_zone || {}, zl = n(z.low), zh = n(z.high);
    var inZone = cmp != null && zl != null && zh != null && cmp >= zl && cmp <= zh;
    var tg = Array.isArray(hd.targets) ? hd.targets : [];
    var vol = tg.map(function (t) { return t && t.volatility_flag; }).filter(Boolean)[0];
    var zoneNote = cmp == null || zl == null ? '' : inZone ? 'Price inside zone' : cmp > zh ? 'Above zone, wait' : 'Below zone';
    var h = '<div class="rx-card"><div style="display:flex;justify-content:space-between;gap:10px">' +
      '<div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b style="font-size:16px;color:var(--text1)">' + esc(hd.symbol) + '</b>' +
      (hd.tier ? chip(String(hd.tier).toUpperCase(), 'var(--text2)', 'var(--bg1)') : '') + (vol ? chip('HIGH VOLATILITY', ORANGE, '#fcefe7') : '') + '</div>' +
      '<div class="rx-muted">' + esc([hd.company_name, hd.sector].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div style="text-align:right"><div style="font-size:16px;font-weight:700">' + inr(cmp) + '</div><div style="font-weight:600;color:' + tone(ret) + '">' + pct(ret) + '</div></div></div>' +
      '<div class="rx-muted" style="margin-top:6px">' + (hd.score != null ? 'Model score <b style="color:var(--text1)">' + plain(hd.score, 0) + '</b> · ' : '') +
      'Added <b style="color:var(--text1)">' + fmtDate(hd.added_on) + '</b>' + (hd.days_held != null ? ' · <b style="color:var(--text1)">' + esc(hd.days_held) + '</b> days held' : '') + '</div>' +
      (hd.why_selected ? '<div style="font-size:12.5px;color:var(--text2);margin-top:8px">' + esc(hd.why_selected) + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">' +
      '<div class="rx-lv"><div class="t">Buy zone</div><div class="v" style="color:' + (inZone ? GREEN : 'var(--text1)') + '">' + (zl != null ? inr(zl) + ' – ' + inr(zh) : '—') + '</div><div class="rx-muted">' + zoneNote + '</div></div>' +
      '<div class="rx-lv"><div class="t">Entry</div><div class="v">' + inr(entry) + '</div><div class="rx-muted">' + fmtDate(hd.added_on) + '</div></div></div>';
    if (tg.length) {
      h += '<table class="rx-tbl" style="margin-top:10px"><tr><th>Horizon</th><th>Target</th><th>Stop</th><th>Reward : risk</th></tr>' + tg.map(function (t) {
        return '<tr><td><b>' + (t.months ? t.months + ' month' + (t.months > 1 ? 's' : '') : esc(t.label)) + '</b></td>' +
          '<td title="' + esc(t.basis) + '"><b>' + inr(t.price) + '</b> <span style="color:' + GREEN + '">' + pct(t.upside_pct) + '</span></td>' +
          '<td title="' + esc(t.stop_basis) + '"><b>' + inr(t.stop) + '</b> <span style="color:' + ORANGE + '">' + pct(t.downside_pct) + '</span></td>' +
          '<td>' + (n(t.reward_risk) != null ? n(t.reward_risk).toFixed(1) + ' : 1' : '—') + '</td></tr>';
      }).join('') + '</table>';
      if (vol) h += '<div style="font-size:11.5px;color:' + ORANGE + ';margin-top:6px">' + esc(vol) + '</div>';
      h += '<details style="margin-top:6px;font-size:11.5px;color:var(--text2)"><summary style="cursor:pointer;color:var(--text3)">How these levels are set</summary>' +
        tg.map(function (t) { return '<div style="margin-top:4px"><b>' + esc(t.label) + '</b>: target ' + esc(t.basis || '—') + '. Stop ' + esc(t.stop_basis || '—') + '.</div>'; }).join('') + '</details>';
    }
    h += '<div style="text-align:right;margin-top:10px"><a class="btn btn-s" style="text-decoration:none;padding:6px 12px" target="_blank" rel="noopener" href="' + API + 'models/report/' +
      encodeURIComponent(hd.symbol) + '?model=' + encodeURIComponent(M.key) + '">Research note (PDF)</a></div></div>';
    return h;
  }
  function pastTable(rows) {
    return '<div class="rx-scroll"><table class="rx-tbl"><tr><th>Symbol</th><th>Added</th><th>Closed</th><th>Entry</th><th>Exit</th><th>Return</th><th style="text-align:left">Reason</th></tr>' +
      rows.map(function (r) {
        var ret = n(pick(r, 'return_pct', 'pnl_pct'));
        return '<tr><td><b>' + esc(r.symbol) + '</b></td><td>' + fmtDate(pick(r, 'added_on', 'entry_date')) + '</td><td>' + fmtDate(pick(r, 'closed_on', 'closed_at', 'exit_date')) + '</td>' +
          '<td>' + inr(pick(r, 'added_price', 'entry_price')) + '</td><td>' + inr(pick(r, 'exit_price', 'closed_price')) + '</td>' +
          '<td style="font-weight:600;color:' + tone(ret) + '">' + pct(ret) + '</td><td style="text-align:left;color:var(--text2)">' + esc(pick(r, 'exit_reason', 'close_reason', 'reason') || '—') + '</td></tr>';
      }).join('') + '</table></div>';
  }
  function methodology(d, meta) {
    var text = typeof d.methodology === 'string' ? d.methodology : (d.methodology && (d.methodology.text || d.methodology.summary));
    var f = d.factors || meta.factors || [];
    var req = d.requires || meta.requires || {};
    var reqList = Array.isArray(req) ? req.map(String) : Object.keys(req).map(function (k) { return GATE[k] ? GATE[k](req[k]) : k.replace(/_/g, ' ') + ': ' + req[k]; });
    var h = text ? '<p style="font-size:13px;color:var(--text2);line-height:1.7;max-width:900px">' + esc(text) + '</p>' : '';
    h += '<div class="rx-h2" style="color:var(--text1)">Factors and weights</div>';
    h += f.length ? '<div class="rx-scroll" style="max-width:700px"><table class="rx-tbl"><tr><th>Factor</th><th>Better when</th><th>Weight</th></tr>' + f.map(function (x) {
      var w = n(x.weight);
      return '<tr><td>' + esc(label(x.field)) + '</td><td>' + (/low|asc|min|less|neg/i.test(x.direction || '') ? 'Lower' : 'Higher') + '</td><td>' + (w == null ? '—' : Math.round(w <= 1 ? w * 100 : w) + '%') + '</td></tr>';
    }).join('') + '</table></div>' : '<div class="rx-muted">Factor list not available.</div>';
    if (reqList.length) h += '<div class="rx-h2" style="color:var(--text1)">Eligibility gates</div><ul style="font-size:13px;color:var(--text2);line-height:1.8;padding-left:20px">' + reqList.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    h += '<div class="rx-h2" style="color:var(--text1)">How positions are managed</div><ul style="font-size:13px;color:var(--text2);line-height:1.8;padding-left:20px;max-width:900px">' +
      ['Each factor is scored 0 to 100. Relative and trend factors are scored against the measured spread of the listed universe; valuation and yield factors against fixed absolute bands.',
        'A name enters only when it ranks near the top and its price is inside the calculated buy zone. Names outside the zone are not chased.',
        'Every position carries four checkpoints, at 1, 3, 6 and 12 months, each with its own target and stop, sized to how far the stock typically moves over that span.',
        'Each checkpoint offers at least 1.5 of upside for every 1 of downside. Stops are held between 4 and 10% at one month and 10 and 25% at twelve, and move to just under a recent low when one sits in that band.',
        'Stocks with annual volatility above about 70% are not admitted. Names above a horizon\'s stop range but below that line are admitted and marked High volatility.',
        'Twelve months is the maximum holding. A position closes at its 12-month checkpoint or on a breach of its 12-month stop, whichever comes first.',
        'A name that leaves the model cannot re-enter for 90 days.'].map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
      '<p class="rx-note">Factor weights are fixed judgements about what each style should reward. They were not fitted to past returns, so the model is not tuned to a historical period.</p>';
    return h;
  }

  /* ════════════════════ BASE RATES ════════════════════ */
  var KIND = { structure: 'Chart pattern', candlestick: 'Candlestick', scan: 'Scan' };
  var DIRC = { BULLISH: GREEN, BEARISH: ORANGE, NEUTRAL: 'var(--text3)' };
  var DIM = { regime: 'Market regime', liquidity: 'Liquidity (median daily traded value)', stock_trend: "Stock's own trend", volume: 'Volume on the day' };
  var VAL = { rising: 'Market above 200-day average', falling: 'Market below 200-day average', above_200: 'Stock above 200-day average', below_200: 'Stock below 200-day average' };
  var B = { h: 20, kind: 'all', sort: 'edge_vs_holding', d: null, sig: null, sd: null, sh: 20 };
  function segH(cur, fn) {
    return '<div class="rx-seg">' + [5, 10, 20, 60].map(function (x) { return '<button class="' + (cur === x ? 'on' : '') + '" onclick="' + fn + '(' + x + ')">' + x + ' sessions</button>'; }).join('') + '</div>';
  }
  function brHome() {
    var el = box('baserates');
    B.sig = null;
    el.innerHTML = '<h2 style="margin:0">Base Rates</h2><p class="rx-lead">How every chart pattern, candlestick and scan has actually played out in Indian stocks. ' +
      'On each past day the detectors saw only the prices up to that day, and the trade was taken at the next open. Use it to check whether a setup has earned your trust before you act on it.</p>' +
      '<div class="rx-card" style="margin-bottom:14px"><b style="font-size:13px">Check a stock</b><span class="rx-muted"> · the signals on its latest session and how each has played out, overall and in today\'s conditions</span>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><input id="rx-brsym" class="rx-in" placeholder="Symbol" onkeydown="if(event.key===\'Enter\')window.__rxBrLive()"><button class="rx-go" onclick="window.__rxBrLive()">Check</button></div>' +
      '<div id="rx-brlive"></div></div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px" id="rx-brctl"></div><div id="rx-brtbl">' + loading() + '</div>';
    brLoad();
  }
  function brLoad() {
    document.getElementById('rx-brtbl').innerHTML = loading();
    brCtl();
    get('base-rates?horizon=' + B.h).then(function (d) { B.d = d; brCtl(); brTable(); })
      .catch(function (e) { document.getElementById('rx-brtbl').innerHTML = errBox(e); });
  }
  function brCtl() {
    var m = B.d && B.d.meta;
    document.getElementById('rx-brctl').innerHTML = segH(B.h, 'window.__rxBrH') +
      '<select class="rx-in" style="text-transform:none;width:auto" onchange="window.__rxBrKind(this.value)">' +
      [['all', 'All signals'], ['structure', 'Chart patterns'], ['candlestick', 'Candlesticks'], ['scan', 'Scans']].map(function (o) {
        return '<option value="' + o[0] + '"' + (B.kind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' +
      (m && m.first_signal ? '<span class="rx-muted">' + Number(m.events || 0).toLocaleString('en-IN') + ' past signals, ' + esc(m.first_signal) + ' to ' + esc(m.last_signal) + '</span>' : '');
  }
  window.__rxBrH = function (h) { B.h = h; brLoad(); };
  window.__rxBrKind = function (k) { B.kind = k; brTable(); };
  window.__rxBrSort = function (k) { B.sort = k; brTable(); };
  function brTable() {
    var d = B.d, min = d.min_cases || 30;
    var rows = (d.signals || []).filter(function (s) { return B.kind === 'all' || s.kind === B.kind; });
    rows.sort(function (a, b) {
      if (a.enough_history !== b.enough_history) return a.enough_history ? -1 : 1;
      return (n(b[B.sort]) == null ? -1e9 : n(b[B.sort])) - (n(a[B.sort]) == null ? -1e9 : n(a[B.sort]));
    });
    B.rows = rows;
    var th = function (k, l) { return '<th style="cursor:pointer" onclick="window.__rxBrSort(\'' + k + '\')">' + l + (B.sort === k ? ' ▾' : '') + '</th>'; };
    var h = '<div class="rx-scroll"><table class="rx-tbl"><tr><th>Signal</th><th style="text-align:left">Type</th>' + th('n', 'Past cases') + th('win', 'Worked') + th('median', 'Median move') +
      '<th>Worst / best tenth</th>' + th('vs_market', 'vs NIFTYBEES') + th('edge_vs_holding', 'Edge over holding') + '<th>Target before stop</th><th>Reward : risk</th><th>Per trade vs holding</th></tr>';
    rows.forEach(function (s, i) {
      var ok = s.enough_history, lv = s.levels || {};
      h += '<tr class="rx-row' + (ok ? '' : ' rx-dim') + '" onclick="window.__rxBrSig(' + i + ')"><td><b style="color:var(--text1)">' + esc(s.signal) + '</b> <span style="font-size:10.5px;font-weight:700;color:' + (DIRC[s.direction] || '') + '">' + esc(s.direction) + '</span></td>' +
        '<td style="text-align:left" class="rx-muted">' + esc(KIND[s.kind] || s.kind) + '</td><td>' + Number(s.n).toLocaleString('en-IN') + '</td>' +
        '<td>' + (ok && s.win != null ? s.win + '%' : '—') + '</td><td style="color:' + tone(s.median) + '">' + (ok ? pct(s.median) : '—') + '</td>' +
        '<td class="rx-muted">' + (ok ? pct(s.p10) + ' / ' + pct(s.p90) : '—') + '</td><td style="color:' + tone(s.vs_market) + '">' + (ok ? pct(s.vs_market, 2) : '—') + '</td>' +
        '<td style="font-weight:700;color:' + tone(s.edge_vs_holding) + '">' + (ok ? pct(s.edge_vs_holding, 2) : 'not enough history') + '</td>' +
        '<td>' + (lv.target_first_pct != null && lv.resolved >= min ? lv.target_first_pct + '%' : '—') + '</td><td>' + (lv.reward_risk != null ? lv.reward_risk + ':1' : '—') + '</td>' +
        '<td style="font-weight:700;color:' + tone(lv.expectancy_vs_holding) + '" title="' + (s.levels ? esc(pct(lv.expectancy_pct, 2) + ' per trade before comparing with the stock; ' + (lv.unresolved_pct == null ? '—' : lv.unresolved_pct) + '% reached neither level within 60 sessions') : '') + '">' +
        (lv.expectancy_vs_holding != null ? pct(lv.expectancy_vs_holding, 2) : '—') + (lv.unresolved_pct > 50 ? ' <span class="rx-muted">‡</span>' : '') + '</td></tr>';
    });
    h += '</table></div><p class="rx-note"><b>Worked</b>: a bullish signal gained more than ' + esc(d.cost_pct) + '% round-trip costs from the next open; a bearish signal fell. ' +
      '<b>Edge over holding</b>: the signal\'s average move less the same stock\'s average move over any window of the same length, so a signal that only rides a rising stock scores near zero. ' +
      '<b>vs NIFTYBEES</b>: the average move less the Nifty ETF over the same days; read it as market context rather than as the signal\'s edge. ' +
      '<b>Target before stop</b>: for patterns with levels, the share of triggered cases that reached the target before the stop within 60 sessions. <b>Reward : risk</b> is the median distance to the target against the distance to the stop. ' +
      '<b>Per trade vs holding</b> is what a triggered trade was worth after ' + esc(d.cost_pct) + '% costs, less what the same stock did over the same days. A high win rate on a reward : risk below 1 still loses money. ' +
      '<b>‡</b> Most triggered cases reached neither level within 60 sessions. <b>Bearish</b> signals count not being long as the gain: read them as exit or avoid signals. ' +
      'Signals with fewer than ' + esc(min) + ' past cases are greyed out. Click a signal to see it split by market conditions. Research on past behaviour, not a forecast or advice.</p>';
    document.getElementById('rx-brtbl').innerHTML = h;
  }
  window.__rxBrSig = function (i) {
    var s = B.rows[i]; if (!s) return;
    B.sig = s; B.sd = null;
    var el = box('baserates');
    el.innerHTML = '<button class="rx-back" onclick="window.__rxBrHome()">← All signals</button><h2 style="margin:0">' + esc(s.signal) +
      ' <span style="font-size:13px;color:' + (DIRC[s.direction] || '') + '">' + esc(s.direction) + '</span></h2><div id="rx-brsd">' + loading() + '</div>';
    get('base-rates/signal?name=' + encodeURIComponent(s.signal) + (s.direction ? '&direction=' + encodeURIComponent(s.direction) : ''))
      .then(function (d) { B.sd = d; brSig(); }).catch(function (e) { document.getElementById('rx-brsd').innerHTML = errBox(e); });
  };
  window.__rxBrHome = function () { brHome(); };
  window.__rxBrSH = function (h) { B.sh = h; brSig(); };
  function hStats(x, ok) {
    x = x || {};
    return '<td>' + (ok && x.win != null ? x.win + '%' : '—') + '</td><td style="color:' + tone(x.median) + '">' + (ok ? pct(x.median) : '—') + '</td>' +
      '<td class="rx-muted">' + (ok ? pct(x.p10) + ' / ' + pct(x.p90) : '—') + '</td><td style="color:' + tone(x.vs_market) + '">' + (ok ? pct(x.vs_market, 2) : '—') + '</td>' +
      '<td style="font-weight:700;color:' + tone(x.edge_vs_holding) + '">' + (ok ? pct(x.edge_vs_holding, 2) : 'not enough history') + '</td>';
  }
  function brSig() {
    var d = B.sd, s = B.sig, min = d.min_cases || 30, all = d.slices && d.slices.all && d.slices.all[0];
    var h = '<p class="rx-lead">' + esc(KIND[s.kind] || s.kind) + '. ' + (all ? Number(all.n).toLocaleString('en-IN') + ' past cases across ' + esc(all.stocks) + ' stocks. ' : '') +
      'The same signal, split by the conditions it appeared in.</p>' + segH(B.sh, 'window.__rxBrSH');
    ['all', 'regime', 'liquidity', 'stock_trend', 'volume'].forEach(function (k) {
      if (!d.slices || !d.slices[k]) return;
      h += '<div class="rx-h2" style="color:' + TEAL + '">' + (k === 'all' ? 'All cases' : DIM[k]) + '</div><div class="rx-scroll"><table class="rx-tbl"><tr><th></th><th>Cases</th><th>Worked</th><th>Median</th><th>Worst / best tenth</th><th>vs market</th><th>Edge over holding</th></tr>';
      d.slices[k].forEach(function (r) {
        var ok = r.n >= min;
        h += '<tr' + (ok ? '' : ' class="rx-dim"') + '><td>' + esc(k === 'all' ? 'Every case' : (VAL[r.val] || r.val)) + '</td><td>' + Number(r.n).toLocaleString('en-IN') + '</td>' + hStats(r['h' + B.sh], ok) + '</tr>';
      });
      h += '</table></div>';
    });
    if (all && all.levels) {
      var lv = all.levels;
      h += '<p style="font-size:13px;color:var(--text2);margin-top:14px;line-height:1.7;max-width:900px">Pattern levels: entry reached in ' + esc(lv.triggered_pct) + '% of cases; once reached, target before stop in <b>' +
        esc(lv.target_first_pct == null ? '—' : lv.target_first_pct) + '%</b> of ' + esc(lv.resolved) + ' resolved cases' +
        (lv.median_days_to_target != null ? ', typically in ' + Math.round(lv.median_days_to_target) + ' sessions' : '') + '.' +
        (lv.reward_risk != null ? ' The target sits ' + pct(lv.reward_pct) + ' from the entry against a ' + pct(-Math.abs(lv.risk_pct)) + ' stop, a reward to risk of <b>' + esc(lv.reward_risk) + ':1</b>.' : '') +
        (lv.expectancy_vs_holding != null ? ' Taking every triggered case, the average was <b style="color:' + tone(lv.expectancy_vs_holding) + '">' + pct(lv.expectancy_vs_holding, 2) + '</b> per trade against holding the same stock over the same days.' : '') + '</p>';
    }
    if (all && all.mae20_median != null) h += '<p style="font-size:13px;color:var(--text2)">Within 20 sessions the typical worst point was ' + pct(all.mae20_median) + ' and the typical best ' + pct(all.mfe20_median) + ' from entry.</p>';
    h += '<p class="rx-note">Research on past behaviour, not a forecast or advice.</p>';
    document.getElementById('rx-brsd').innerHTML = h;
  }
  window.__rxBrLive = function () {
    var sym = (document.getElementById('rx-brsym').value || '').trim().toUpperCase();
    var out = document.getElementById('rx-brlive');
    if (!sym) return;
    out.innerHTML = loading();
    get('base-rates/live/' + encodeURIComponent(sym)).then(function (d) {
      var sigs = d.signals || [], c = d.context || {}, min = d.min_cases || 30;
      var h = '<div class="rx-muted" style="margin:10px 0 6px"><b style="color:var(--text1)">' + esc(d.symbol) + '</b> · close ' + inr(d.close) + ' on ' + fmtDate(d.as_of) +
        ' · ' + esc([VAL[c.regime] || c.regime, c.liquidity ? 'liquidity ' + c.liquidity : '', VAL[c.stock_trend] || c.stock_trend, c.volume].filter(Boolean).join(' · ')) + '</div>';
      if (!sigs.length) { out.innerHTML = h + '<div class="rx-muted">No pattern or scan signal on the latest session.</div>'; return; }
      h += '<div class="rx-scroll"><table class="rx-tbl"><tr><th>Signal</th><th>Levels</th><th>Cases</th><th>Worked (20 sessions)</th><th>Median</th><th>Edge over holding</th><th>In today\'s market regime</th></tr>';
      sigs.forEach(function (s) {
        var o = s.overall || {}, x = o.h20 || {}, ok = (o.n || 0) >= min, rg = s.in_context && s.in_context.regime, rx = rg && rg.h20 || {};
        h += '<tr><td><b>' + esc(s.signal) + '</b> <span style="font-size:10.5px;font-weight:700;color:' + (DIRC[s.direction] || '') + '">' + esc(s.direction) + '</span>' +
          (s.note ? '<div class="rx-muted">' + esc(s.note) + '</div>' : '') + '</td>' +
          '<td class="rx-muted">' + (s.entry != null ? 'entry ' + inr(s.entry) + (s.target != null ? ', target ' + inr(s.target) : '') + (s.stoploss != null ? ', stop ' + inr(s.stoploss) : '') : '—') + '</td>' +
          '<td>' + (o.n != null ? Number(o.n).toLocaleString('en-IN') : '—') + '</td><td>' + (ok && x.win != null ? x.win + '%' : '—') + '</td>' +
          '<td style="color:' + tone(x.median) + '">' + (ok ? pct(x.median) : '—') + '</td><td style="font-weight:700;color:' + tone(x.edge_vs_holding) + '">' + (ok ? pct(x.edge_vs_holding, 2) : '—') + '</td>' +
          '<td>' + (rg && rg.n >= min ? (rx.win != null ? rx.win + '% worked, ' : '') + '<span style="color:' + tone(rx.edge_vs_holding) + '">' + pct(rx.edge_vs_holding, 2) + ' edge</span>' : '—') + '</td></tr>';
      });
      out.innerHTML = h + '</table></div>';
    }).catch(function (e) { out.innerHTML = errBox(e); });
  };

  /* ════════════════════ STOCK RESEARCH ════════════════════ */
  var KEYM = [['pe_ttm', 'P/E (TTM)', 'x'], ['pb_ratio', 'Price to book', 'x'], ['ev_ebitda', 'EV / EBITDA', 'x'], ['roe', 'ROE', '%'], ['roce', 'ROCE', '%'],
    ['ebitda_margin', 'EBITDA margin', '%'], ['net_margin', 'Net margin', '%'], ['debt_to_equity', 'Debt to equity', 'x'], ['interest_coverage', 'Interest cover', 'x'],
    ['revenue_growth_yoy', 'Revenue growth YoY', 'g'], ['pat_growth_yoy', 'Profit growth YoY', 'g'], ['eps_ttm', 'EPS (TTM)', 'r'], ['market_cap', 'Market cap (₹ cr)', 'n']];
  var PCOLS = [['pe_ttm', 'P/E', 'x'], ['pb_ratio', 'P/B', 'x'], ['roe', 'ROE', '%'], ['roce', 'ROCE', '%'], ['ebitda_margin', 'EBITDA mgn', '%'], ['net_margin', 'Net mgn', '%'],
    ['revenue_growth_yoy', 'Rev YoY', 'g'], ['pat_growth_yoy', 'PAT YoY', 'g'], ['debt_to_equity', 'D/E', 'x'], ['eps_ttm', 'EPS TTM', 'r']];
  function fmtK(v, t) { v = n(v); if (v == null) return '—'; if (t === '%') return v.toFixed(1) + '%'; if (t === 'g') return pct(v); if (t === 'x') return v.toFixed(2); if (t === 'r') return inr(v); return plain(v, 0); }
  function srHome() {
    box('stockresearch').innerHTML = '<h2 style="margin:0">Stock Research</h2><p class="rx-lead">The workup for one listed company: business trend over up to 12 quarters, valuation against its own range, ' +
      'sector peers, what has changed, and the risks the price chart does not show (promoter pledge and encumbrance, how long a position takes to sell, and exchange surveillance). Research, not advice.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="rx-srsym" class="rx-in" placeholder="Symbol, e.g. RELIANCE" onkeydown="if(event.key===\'Enter\')window.__rxSr()"><button class="rx-go" onclick="window.__rxSr()">Research</button></div>' +
      '<div id="rx-srout"></div>';
  }
  window.__rxSr = function (symArg) {
    var sym = (symArg || document.getElementById('rx-srsym').value || '').trim().toUpperCase();
    if (!sym) return;
    var out = document.getElementById('rx-srout');
    out.innerHTML = '<div id="rx-srrisk">' + loading('Loading risk checks…') + '</div><div id="rx-srdeep">' + loading('Loading research…') + '</div>';
    get('stock-risk/' + encodeURIComponent(sym)).then(function (d) { document.getElementById('rx-srrisk').innerHTML = riskView(d); })
      .catch(function (e) { document.getElementById('rx-srrisk').innerHTML = errBox(e); });
    get('stock/' + encodeURIComponent(sym)).then(function (d) { document.getElementById('rx-srdeep').innerHTML = deepView(d); })
      .catch(function (e) { document.getElementById('rx-srdeep').innerHTML = errBox(e); });
  };
  window.__rxOpenResearch = function (sym) {
    if (typeof window.nav === 'function') window.nav('stockresearch', null);
    setTimeout(function () { var i = document.getElementById('rx-srsym'); if (i) i.value = sym; window.__rxSr(sym); }, 50);
  };
  function flagBox(f) {
    var lv = (f && f.level) || '', c = lv === 'good' ? ['#ecfdf5', '#065f46'] : lv === 'bad' || lv === 'warn' || lv === 'warning' ? ['#fff7ed', '#9a3412'] : ['var(--bg1)', 'var(--text2)'];
    return '<div class="rx-flag" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(f.text || f) + '</div>';
  }
  function riskView(d) {
    var h = '<div class="rx-h2" style="color:' + TEAL + '">Risks the chart does not show</div><div class="rx-grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">';
    var el = d.eligibility || {};
    h += '<div class="rx-card"><b>Exchange surveillance</b><div style="font-size:13px;color:' + (el.clear ? GREEN : ORANGE) + ';margin-top:6px;line-height:1.5">' + esc(el.summary || (el.available === false ? 'Not available.' : '')) + '</div>' +
      (Array.isArray(el.notes) ? el.notes.map(function (x) { return '<div class="rx-muted" style="margin-top:4px">' + esc(x) + '</div>'; }).join('') : '') + '</div>';
    var o = d.ownership || {};
    h += '<div class="rx-card"><b>Promoter holding and pledge</b>' + (o.available === false ? '<div class="rx-muted">Not available.</div>' :
      '<div class="rx-kv" style="margin-top:8px"><div class="rx-lv"><div class="t">Promoter</div><div class="v">' + fmtK(o.promoter_pct, '%') + '</div></div>' +
      '<div class="rx-lv"><div class="t">Pledged</div><div class="v">' + fmtK(o.pledged_pct, '%') + '</div></div><div class="rx-lv"><div class="t">Encumbered</div><div class="v">' + fmtK(o.encumbered_pct, '%') + '</div></div></div>' +
      (o.flags || []).map(flagBox).join('') + '<div class="rx-muted">As of ' + fmtDate(o.as_of) + '</div>') + '</div>';
    var lq = d.liquidity || {};
    h += '<div class="rx-card"><b>How long a position takes to sell</b>' + (lq.available === false ? '<div class="rx-muted">Not available.</div>' :
      '<div style="font-size:13px;margin-top:6px;color:var(--text2)">' + esc(lq.verdict || '') + '</div>' +
      '<table class="rx-tbl" style="margin-top:8px"><tr><th>Position</th><th>Share of a normal day</th><th>Time to exit</th></tr>' + (lq.sizes || []).map(function (s) {
        return '<tr><td>' + inr(s.position_value) + '</td><td>' + esc(s.share_of_day_text) + '</td><td style="color:' + (s.comfortable ? GREEN : ORANGE) + '">' + esc(s.days_text) + '</td></tr>';
      }).join('') + '</table><div class="rx-muted" style="margin-top:6px">Median daily value ' + inr(lq.median_daily_value_cr) + ' cr over ' + esc(lq.sessions_measured) + ' sessions, selling at ' + esc(lq.participation_assumed_pct) + '% of a normal day.</div>') + '</div>';
    h += '</div>';
    if (o.series && o.series.length) {
      h += '<div class="rx-scroll" style="margin-top:12px"><table class="rx-tbl"><tr><th>Quarter</th><th>Promoter</th><th>Pledged</th><th>Encumbered</th><th>FII</th><th>DII</th><th>MF</th><th>Retail</th></tr>' +
        o.series.slice().reverse().map(function (r) {
          return '<tr><td>' + fmtDate(r.period) + '</td>' + ['promoter', 'pledged', 'encumbered', 'fii', 'dii', 'mf', 'retail'].map(function (k) { return '<td>' + fmtK(r[k], '%') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</table></div>';
    }
    return h + (d.disclaimer ? '<p class="rx-note">' + esc(d.disclaimer) + '</p>' : '');
  }
  function isRowList(v) { return Array.isArray(v) && v.length && v.every(function (x) { return x && typeof x === 'object' && !Array.isArray(x); }); }
  function genericTable(rows) {
    var cols = [];
    rows.slice(0, 20).forEach(function (r) { Object.keys(r).forEach(function (k) { var v = r[k]; if (cols.indexOf(k) < 0 && (v == null || typeof v !== 'object')) cols.push(k); }); });
    cols = cols.slice(0, 12);
    return '<div class="rx-scroll"><table class="rx-tbl"><tr>' + cols.map(function (c) { return '<th>' + esc(label(c)) + '</th>'; }).join('') + '</tr>' +
      rows.slice(0, 40).map(function (r) {
        return '<tr>' + cols.map(function (c) { var v = r[c]; return '<td>' + (typeof v === 'number' ? plain(v, 2) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : esc(v == null ? '—' : v)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table></div>';
  }
  function genericBlock(v) {
    if (v == null) return '';
    if (typeof v !== 'object') return '<p style="font-size:13px;color:var(--text2);line-height:1.6">' + esc(v) + '</p>';
    if (isRowList(v)) return genericTable(v);
    if (Array.isArray(v)) return '<ul style="font-size:13px;color:var(--text2);padding-left:20px;line-height:1.7">' + v.map(function (x) { return '<li>' + esc(typeof x === 'object' ? JSON.stringify(x) : x) + '</li>'; }).join('') + '</ul>';
    var flat = '', nested = '';
    Object.keys(v).forEach(function (k) {
      var x = v[k];
      if (x == null || typeof x !== 'object') flat += '<div class="rx-lv"><div class="t">' + esc(label(k)) + '</div><div class="v" style="font-weight:600">' + (typeof x === 'number' ? plain(x, 2) : typeof x === 'boolean' ? (x ? 'Yes' : 'No') : esc(x == null ? '—' : x)) + '</div></div>';
      else nested += '<div style="margin-top:10px"><div class="rx-muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.5px;font-size:10.5px">' + esc(label(k)) + '</div>' + genericBlock(x) + '</div>';
    });
    return (flat ? '<div class="rx-kv">' + flat + '</div>' : '') + nested;
  }
  function deepView(d) {
    var c = d.company || {}, l = d.latest || {};
    var h = '<div class="rx-h2" style="color:' + TEAL + '">Business and valuation</div><div class="rx-card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
      '<div><b style="font-size:17px;color:var(--text1)">' + esc(c.company_name || c.symbol) + '</b><div class="rx-muted">' + esc([c.symbol, c.sector, c.industry].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div style="text-align:right"><div style="font-size:17px;font-weight:700">' + inr(l.price_used) + '</div><div class="rx-muted">52-week ' + inr(l.low_52w) + ' – ' + inr(l.high_52w) + '</div></div></div>' +
      '<div class="rx-kv" style="margin-top:12px">' + KEYM.map(function (k) { return '<div class="rx-lv"><div class="t">' + k[1] + '</div><div class="v">' + fmtK(l[k[0]], k[2]) + '</div></div>'; }).join('') + '</div>' +
      '<div class="rx-muted" style="margin-top:8px">Latest quarter ' + fmtDate(l.period_end) + (l.balance_sheet_as_of ? ' · balance sheet as of ' + fmtDate(l.balance_sheet_as_of) : '') + '</div></div>';
    if (d.periods && d.periods.length) {
      h += '<div class="rx-h2" style="color:var(--text1)">Quarter by quarter</div><div class="rx-scroll"><table class="rx-tbl"><tr><th>Quarter</th>' + PCOLS.map(function (k) { return '<th>' + k[1] + '</th>'; }).join('') + '</tr>' +
        d.periods.map(function (p) { return '<tr><td>' + fmtDate(p.period_end) + '</td>' + PCOLS.map(function (k) { return '<td>' + fmtK(p[k[0]], k[2]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>';
    }
    if (d.earnings_quality && d.earnings_quality.length) {
      h += '<div class="rx-h2" style="color:var(--text1)">Earnings quality</div><div class="rx-scroll"><table class="rx-tbl"><tr><th>Quarter</th><th>Other income share of profit</th><th>Tax rate</th><th>Interest cover</th><th>Net debt (₹ cr)</th><th>Net debt to equity</th></tr>' +
        d.earnings_quality.map(function (r) {
          return '<tr><td>' + fmtDate(r.period_end) + (r.balance_sheet_carried ? ' <span class="rx-muted" title="Balance sheet carried from ' + esc(r.balance_sheet_as_of) + '">*</span>' : '') + '</td><td>' + fmtK(r.other_income_share, '%') + '</td><td>' + fmtK(r.tax_rate, '%') +
            '</td><td>' + fmtK(r.interest_cover, 'x') + '</td><td>' + plain(r.net_debt_cr, 0) + '</td><td>' + fmtK(r.net_debt_to_equity, 'x') + '</td></tr>';
        }).join('') + '</table></div><div class="rx-muted" style="margin-top:4px">* balance sheet carried from the last half-year filing.</div>';
    }
    Object.keys(d).forEach(function (k) {
      if (['company', 'latest', 'periods', 'earnings_quality', 'disclaimer', 'generated_at', 'symbol'].indexOf(k) >= 0) return;
      var v = d[k];
      if (v == null || (Array.isArray(v) && !v.length)) return;
      h += '<div class="rx-h2" style="color:var(--text1)">' + esc(label(k)) + '</div>' + genericBlock(v);
    });
    return h + '<p class="rx-note">' + esc(d.disclaimer || 'Research, not advice. Values outside a plausible range are left blank rather than shown.') + '</p>';
  }

  /* ── start ── */
  function start() {
    if (!install()) { setTimeout(start, 300); return; }
    wrapNav();
    setTimeout(wrapNav, 1500);   // in case the page or another script redefines nav after load
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
