/* DYOR investment research panels: Mutual Funds, ETFs, Bonds, Insurance.
   Loaded by /var/www/dyor.html from /dyor/api/research/funds.js. Data from /dyor/api/research/{mf,etf,debt,insurance}/*,
   the same data service AlphaLab uses. Research, not advice; open to any signed-in user. */
(function () {
  if (window.__rxfLoaded) return;
  window.__rxfLoaded = true;
  var API = '/dyor/api/research/';
  var TEAL = '#0f4c5c', RED = '#e84215', GREEN = '#15803d', AMBER = '#b45309';
  var COLORS = [TEAL, RED, '#7c3aed', '#6b7280'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { var x = typeof v === 'string' ? parseFloat(v) : v; return typeof x === 'number' && isFinite(x) ? x : null; }
  function p(v, sign) { v = n(v); if (v == null) return '—'; return (sign && v > 0 ? '+' : '') + v + '%'; }
  function inr(v) { v = n(v); return v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function day(s) { return s ? String(s).slice(0, 10) : '—'; }
  function daysOld(s) { var d = new Date(String(s).slice(0, 10)); return isNaN(d) ? null : Math.floor((Date.now() - d.getTime()) / 864e5); }
  function staleNote(date, what) {
    var o = daysOld(date);
    if (o == null || o <= 7) return '';
    return '<div class="rx-flag" style="background:#fff7ed;color:#9a3412">' + esc(what) + ' data is as of ' + esc(day(date)) + ' (' + o + ' days old). Figures below are from that date, not today.</div>';
  }
  function get(path) {
    return fetch(API + path, { credentials: 'include' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error((d && d.detail) || ('HTTP ' + r.status));
        return d;
      });
    });
  }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error((d && d.detail) || ('HTTP ' + r.status)); return d; }); });
  }
  function loading(t) { return '<div class="rx-muted" style="padding:16px 0">' + esc(t || 'Loading…') + '</div>'; }
  function errBox(e) { return '<div class="rx-err">Could not load: ' + esc(e && e.message || e) + '</div>'; }
  function pill(label, on, onclick) { return '<button class="rxf-pill' + (on ? ' on' : '') + '" onclick="' + onclick + '">' + label + '</button>'; }
  function bar(v, color) { v = n(v) || 0; return '<div class="rxf-bar"><div style="width:' + Math.max(0, Math.min(100, v)) + '%;background:' + (color || TEAL) + '"></div></div>'; }
  function spark(pts, key, h, color, zero) {
    if (!pts || pts.length < 3) return '';
    var vs = pts.map(function (x) { return n(x[key]); }).filter(function (x) { return x != null; });
    var mn = Math.min.apply(null, vs.concat(zero ? [0] : [])), mx = Math.max.apply(null, vs.concat(zero ? [0] : []));
    var y = function (v) { return h - 6 - ((v - mn) / (mx - mn || 1)) * (h - 12); };
    var line = pts.map(function (x, i) { return (i / (pts.length - 1) * 640).toFixed(1) + ',' + y(n(x[key]) || 0).toFixed(1); }).join(' ');
    return '<svg width="100%" viewBox="0 0 640 ' + h + '" style="display:block;margin:6px 0">' +
      (zero ? '<line x1="0" x2="640" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#d5d5d0" stroke-dasharray="4 3"/>' : '') +
      '<polyline points="' + line + '" fill="none" stroke="' + (color || TEAL) + '" stroke-width="1.8"/></svg>';
  }

  var css = '.rxf-pill{padding:4px 11px;border-radius:14px;border:1px solid var(--border);background:var(--bg2);font-size:12px;color:var(--text2);cursor:pointer;margin:0 4px 6px 0}' +
    '.rxf-pill.on{background:' + TEAL + ';border-color:' + TEAL + ';color:#fff}.rxf-pill.col{border-color:rgba(15,76,92,.4);color:' + TEAL + '}' +
    '.rxf-bar{flex:1;height:10px;background:var(--bg1);border-radius:6px;overflow:hidden}.rxf-bar>div{height:100%;border-radius:6px;opacity:.85}' +
    '.rxf-row{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px}' +
    '.rxf-ov{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.rxf-modal{background:var(--bg2);border-radius:10px;max-width:880px;width:100%;max-height:88vh;overflow-y:auto;padding:22px;box-shadow:0 10px 40px rgba(0,0,0,.2)}' +
    '.rxf-sec{font-size:11.5px;font-weight:700;color:' + TEAL + ';text-transform:uppercase;letter-spacing:.5px;margin:12px 0 4px}' +
    '.rxf-p{font-size:13px;color:var(--text2);line-height:1.65}.rxf-x{float:right;background:none;border:none;font-size:22px;color:var(--text3);cursor:pointer}' +
    '.rxf-sug{position:absolute;top:100%;left:0;width:440px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);z-index:50}' +
    '.rxf-sug button{display:block;width:100%;text-align:left;padding:8px 12px;border:none;border-bottom:1px solid var(--border);background:none;cursor:pointer}' +
    '.rxf-sug button:hover{background:var(--bg1)}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ── menu ── */
  var PANELS = [['mfresearch', 'Mutual Funds'], ['etfresearch', 'ETFs'], ['bondsresearch', 'Bonds'], ['insurance', 'Insurance']];
  function install() {
    var anchor = document.getElementById('ng-portfolio'), host = document.getElementById('p-emerging');
    if (!anchor || !host) return false;
    if (document.getElementById('ng-invresearch')) return true;
    var g = document.createElement('div');
    g.className = 'nav-group'; g.id = 'ng-invresearch';
    g.innerHTML = '<div class="nav-group-header" onclick="toggleNavGroup(\'ng-invresearch\')">INVESTMENT RESEARCH <span class="nav-arrow">&#9654;</span></div>' +
      '<div class="nav-group-items">' + PANELS.map(function (x) { return '<button class="nbtn" onclick="nav(\'' + x[0] + '\',this)">' + x[1] + '</button>'; }).join('') + '</div>';
    anchor.parentNode.insertBefore(g, anchor);
    PANELS.forEach(function (x) {
      var el = document.createElement('div'); el.id = 'p-' + x[0]; el.className = 'panel';
      el.innerHTML = '<div class="rx-wrap" id="rxf-' + x[0] + '"></div>';
      host.parentNode.appendChild(el);
    });
    return true;
  }
  var loaded = {};
  function wrapNav() {
    var orig = window.nav;
    if (typeof orig !== 'function' || orig.__rxf) return;
    var w = function (pn) {
      var r = orig.apply(this, arguments);
      var fn = { mfresearch: mfHome, etfresearch: etfHome, bondsresearch: bondsHome, insurance: insHome }[pn];
      if (fn && !loaded[pn]) { loaded[pn] = true; fn(); }
      return r;
    };
    w.__rxf = true;
    window.nav = w;
  }
  function box(id) { return document.getElementById('rxf-' + id); }
  function modal(html) {
    closeModal();
    var o = document.createElement('div'); o.className = 'rxf-ov'; o.id = 'rxf-ov';
    o.onclick = function (e) { if (e.target === o) closeModal(); };
    o.innerHTML = '<div class="rxf-modal"><button class="rxf-x" onclick="window.__rxfClose()">×</button><div id="rxf-mbody">' + html + '</div></div>';
    document.body.appendChild(o);
  }
  function closeModal() { var o = document.getElementById('rxf-ov'); if (o) o.remove(); }
  window.__rxfClose = closeModal;
  function mbody(html) { var b = document.getElementById('rxf-mbody'); if (b) b.innerHTML = html; }

  /* ════════════════════ MUTUAL FUNDS ════════════════════ */
  var CATS = ['', 'Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'Multi Cap', 'ELSS', 'Value', 'Focused', 'Liquid', 'Corporate Bond', 'Gilt'];
  var COLL = [['Top performers (5Y)', '', 'cagr_5y'], ['Consistency', '', 'roll3_pos_pct'], ['Top ELSS (tax savers)', 'ELSS', 'roll3_median'],
    ['Best mid caps', 'Mid Cap', 'roll3_median'], ['Calm money (liquid)', 'Liquid', 'roll3_pos_pct'], ['Large and steady', 'Large Cap', 'roll3_pos_pct'],
    ['Small cap leaders', 'Small Cap', 'roll3_median'], ['Flexi all-rounders', 'Flexi Cap', 'roll3_median'], ['Value funds', 'Value', 'roll3_median']];
  var MF = { view: 'explore', cat: 'Flexi Cap', sort: 'roll3_median', cmp: [], dnaSort: 'value', fund: null, tool: 'story', cache: {} };
  function distBand(r) {
    var p25 = n(r.roll3_p25), med = n(r.roll3_median), p75 = n(r.roll3_p75), worst = n(r.roll3_worst);
    if (med == null || p25 == null || p75 == null) return '<span class="rx-muted">—</span>';
    var lo = Math.min(worst == null ? p25 : worst, p25, -5), hi = Math.max(p75, 25), x = function (v) { return ((v - lo) / (hi - lo)) * 120; };
    return '<svg width="120" height="18"><line x1="' + x(0) + '" y1="2" x2="' + x(0) + '" y2="16" stroke="#d5d5d0"/>' +
      '<rect x="' + x(p25) + '" y="6" width="' + Math.max(x(p75) - x(p25), 2) + '" height="6" rx="3" fill="' + TEAL + '" opacity=".25"/>' +
      '<line x1="' + x(med) + '" y1="4" x2="' + x(med) + '" y2="14" stroke="' + TEAL + '" stroke-width="2.5"/>' +
      (worst != null ? '<circle cx="' + x(worst) + '" cy="9" r="2.2" fill="' + RED + '"/>' : '') + '</svg>';
  }
  function mfHome() {
    var el = box('mfresearch');
    el.innerHTML = '<h2 style="margin:0">Mutual Funds</h2><div style="margin:10px 0 6px">' +
      pill('Explore funds', MF.view === 'explore', "window.__rxfMfView('explore')") + pill('Portfolio DNA', MF.view === 'dna', "window.__rxfMfView('dna')") + '</div><div id="rxf-mfbody"></div>';
    if (MF.view === 'dna') return dnaBoard();
    var b = document.getElementById('rxf-mfbody');
    b.innerHTML = '<p class="rx-lead">Every fund with its <b>rolling 3-year return distribution</b>: the band is the middle half of all 3-year holding periods, the tick is the median and the ' +
      '<span style="color:' + RED + '">dot</span> is the worst window. Click a fund for its full story. Tick up to three to compare.</p>' +
      '<div><span class="rx-muted" style="font-weight:700;text-transform:uppercase;font-size:10.5px;margin-right:6px">Collections</span>' +
      COLL.map(function (c, i) { return '<button class="rxf-pill col" onclick="window.__rxfColl(' + i + ')">' + esc(c[0]) + '</button>'; }).join('') + '</div>' +
      '<div style="margin:4px 0">' + CATS.map(function (c) { return pill(c || 'All', MF.cat === c, "window.__rxfCat('" + c + "')"); }).join('') + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin:6px 0 12px;flex-wrap:wrap"><div style="position:relative"><input id="rxf-mfq" class="rx-in" style="text-transform:none;width:280px" placeholder="Find a fund (3+ letters)" oninput="window.__rxfSug(this.value)"><div id="rxf-sug"></div></div>' +
      '<select class="rx-in" style="text-transform:none;width:auto" onchange="window.__rxfSort(this.value)">' +
      [['roll3_median', 'Sort: median 3Y (rolling)'], ['roll3_pos_pct', 'Sort: % windows positive'], ['cagr_5y', 'Sort: 5Y CAGR'], ['ret_1y', 'Sort: 1Y return']].map(function (o) {
        return '<option value="' + o[0] + '"' + (MF.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div><div id="rxf-cmpbar"></div><div id="rxf-mftbl">' + loading('Reading fund histories…') + '</div>';
    cmpBar(); mfLoad();
  }
  window.__rxfMfView = function (v) { MF.view = v; mfHome(); };
  window.__rxfColl = function (i) { MF.cat = COLL[i][1]; MF.sort = COLL[i][2]; mfHome(); };
  window.__rxfCat = function (c) { MF.cat = c; mfHome(); };
  window.__rxfSort = function (s) { MF.sort = s; mfLoad(); };
  function mfLoad() {
    var t = document.getElementById('rxf-mftbl'); if (!t) return;
    t.innerHTML = loading('Reading fund histories…');
    get('mf/screener?category=' + encodeURIComponent(MF.cat) + '&sort=' + MF.sort + '&limit=60').then(function (d) {
      var rs = d.results || [];
      if (!rs.length) { t.innerHTML = '<div class="empty">Nothing here' + (MF.cat ? ' in ' + esc(MF.cat) : '') + '.</div>'; return; }
      var newest = rs.map(function (r) { return r.nav_date; }).filter(Boolean).sort().slice(-1)[0];
      MF.rows = rs;
      t.innerHTML = staleNote(newest, 'Fund NAV') + '<div class="rx-scroll"><table class="rx-tbl"><tr><th></th><th>Fund</th><th style="text-align:left">Rolling 3Y distribution</th><th>Median 3Y</th><th>% positive</th><th>5Y CAGR</th><th>1Y</th><th>Rank</th></tr>' +
        rs.map(function (r, i) {
          var on = MF.cmp.some(function (c) { return c.code === r.scheme_code; });
          return '<tr><td><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="window.__rxfCmp(' + i + ')"></td>' +
            '<td style="cursor:pointer" onclick="window.__rxfFund(' + r.scheme_code + ')"><b style="color:var(--text1)">' + esc(String(r.scheme_name).replace(/ - Direct.*$/i, '').slice(0, 56)) + '</b><div class="rx-muted">' + esc(r.amc) + '</div></td>' +
            '<td style="text-align:left;cursor:pointer" onclick="window.__rxfFund(' + r.scheme_code + ')">' + distBand(r) + '</td><td>' + p(r.roll3_median) + '</td><td>' + p(r.roll3_pos_pct) + '</td><td>' + p(r.cagr_5y) + '</td><td>' + p(r.ret_1y) + '</td>' +
            '<td>' + (r.cat_rank ? r.cat_rank + '/' + r.cat_n : '—') + '</td></tr>';
        }).join('') + '</table></div><p class="rx-note">' + esc(d.note || '') + ' Research, not advice.</p>';
    }).catch(function (e) { t.innerHTML = errBox(e); });
  }
  var sugT = null;
  window.__rxfSug = function (q) {
    clearTimeout(sugT);
    var s = document.getElementById('rxf-sug');
    if (!q || q.trim().length < 3) { s.innerHTML = ''; return; }
    sugT = setTimeout(function () {
      get('mf/search?q=' + encodeURIComponent(q.trim())).then(function (d) {
        var rs = d.results || [];
        s.innerHTML = rs.length ? '<div class="rxf-sug">' + rs.map(function (f) {
          return '<button onclick="document.getElementById(\'rxf-sug\').innerHTML=\'\';window.__rxfFund(' + f.scheme_code + ')"><div style="font-size:12.5px;font-weight:600">' + esc(f.scheme_name) + '</div>' +
            '<div class="rx-muted" style="font-size:11px">' + esc([f.amc, f.category, f.plan].filter(Boolean).join(' · ')) + (f.roll3_median != null ? ' · median 3Y ' + f.roll3_median + '%' : '') + '</div></button>';
        }).join('') + '</div>' : '';
      }).catch(function () { s.innerHTML = ''; });
    }, 250);
  };
  window.__rxfCmp = function (i) {
    var r = MF.rows[i]; if (!r) return;
    var k = MF.cmp.findIndex(function (c) { return c.code === r.scheme_code; });
    if (k >= 0) MF.cmp.splice(k, 1); else if (MF.cmp.length < 3) MF.cmp.push({ code: r.scheme_code, name: String(r.scheme_name).replace(/ - Direct.*$/i, '') });
    cmpBar(); mfLoad();
  };
  function cmpBar() {
    var b = document.getElementById('rxf-cmpbar'); if (!b) return;
    b.innerHTML = MF.cmp.length ? '<div class="rx-card" style="padding:10px 12px;margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="rx-muted">Compare:</span>' +
      MF.cmp.map(function (c, i) { return '<span class="rx-chip" style="border:1px solid ' + COLORS[i] + ';color:' + COLORS[i] + '">' + esc(c.name.slice(0, 30)) + '</span>'; }).join('') +
      (MF.cmp.length >= 2 ? '<button class="rx-go" style="margin-left:auto" onclick="window.__rxfCompare()">Compare ' + MF.cmp.length + ' funds</button>' : '<span class="rx-muted">tick one more</span>') + '</div>' : '';
  }
  function enrich(code) {
    return get('mf/xray/' + code).then(function (d) {
      return Promise.all([get('mf/behaviour/' + code).catch(function () { return null; }), get('mf/probability/' + code).catch(function () { return null; })])
        .then(function (x) { d._beh = x[0]; d._prob = x[1]; return d; });
    });
  }
  window.__rxfCompare = function () {
    modal('<h3 style="margin:0 0 10px">Side by side</h3>' + loading('Reading histories…'));
    var jobs = MF.cmp.map(function (c) { return enrich(c.code).catch(function () { return null; }); });
    jobs.push(get('etf/detail/NIFTYBEES').then(function (nb) { return nb && nb.scheme_code ? enrich(nb.scheme_code).then(function (b) { b._bench = true; return b; }) : null; }).catch(function () { return null; }));
    Promise.all(jobs).then(function (ds) {
      ds = ds.filter(Boolean);
      if (!ds.length) { mbody('<h3 style="margin:0 0 6px">Side by side</h3><div class="rx-err">Could not load these funds. Please try again.</div>'); return; }
      var series = ds.filter(function (d) { return d.nav_series && d.nav_series.length; });
      var start = series.map(function (d) { return d.nav_series[0].d; }).sort().slice(-1)[0];
      var norm = series.map(function (d) { var c = d.nav_series.filter(function (q) { return q.d >= start; }); var b0 = c.length ? c[0].v : 1; return c.map(function (q) { return q.v / b0 * 100; }); });
      var all = [].concat.apply([], norm), mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
      var svg = '<svg width="100%" viewBox="0 0 640 180">' + norm.map(function (s, i) {
        return '<polyline fill="none" stroke-width="1.8" stroke="' + (series[i]._bench ? '#9ca3af' : COLORS[i]) + '" points="' + s.map(function (v, j) { return (j / (s.length - 1) * 640).toFixed(1) + ',' + (170 - (v - mn) / (mx - mn || 1) * 160).toFixed(1); }).join(' ') + '"/>';
      }).join('') + '</svg>';
      var h5 = function (d, k) { var h = ((d._prob && d._prob.horizons) || []).filter(function (x) { return x.years === 5; })[0]; return h && h[k] != null ? h[k] + '%' : '—'; };
      var rows = [['Median 3Y (rolling)', function (d) { return p(d.scheme && d.scheme.roll3_median); }], ['% 3Y windows positive', function (d) { return p(d.scheme && d.scheme.roll3_pos_pct); }],
        ['Worst 3Y window', function (d) { return p(d.scheme && d.scheme.roll3_worst); }], ['5Y CAGR', function (d) { return p(d.scheme && d.scheme.cagr_5y); }],
        ['SIP 5Y XIRR', function (d) { return d.sip && d.sip.y5 ? d.sip.y5.xirr + '%' : '—'; }], ['Max fall', function (d) { return d.drawdown ? d.drawdown.max_pct + '%' : '—'; }],
        ['Typical yearly swing', function (d) { return p(d.vol_annual_pct); }], ['Category rank', function (d) { return d._bench ? 'the benchmark' : d.scheme && d.scheme.cat_rank ? d.scheme.cat_rank + '/' + d.scheme.cat_n : '—'; }],
        ['Ease of holding', function (d) { return d._beh && d._beh.score != null ? d._beh.score + '/100' : '—'; }], ['Positive over any 5 years', function (d) { return h5(d, 'p_positive'); }],
        ['Beat the Nifty over any 5 years', function (d) { return d._bench ? '—' : h5(d, 'p_beat_benchmark'); }]];
      if (!series.length) svg = '';
      mbody('<h3 style="margin:0 0 6px">Side by side</h3>' + svg + (series.length ? '<div class="rx-muted">All indexed to 100 at the common start date, ' + esc(start) + '.</div>' : '') +
        '<div class="rx-scroll" style="margin-top:10px"><table class="rx-tbl"><tr><th>Measure</th>' + ds.map(function (d, i) {
          return '<th style="color:' + (d._bench ? '#6b7280' : COLORS[i]) + '">' + esc(d._bench ? 'NIFTYBEES (the index)' : String(d.scheme && d.scheme.scheme_name || '').split(' - ')[0].slice(0, 26)) + '</th>';
        }).join('') + '</tr>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td>' + ds.map(function (d) { return '<td>' + r[1](d) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</table></div><p class="rx-note">Computed from each fund\'s published NAV history. Research, not advice.</p>');
    });
  };

  var TOOLS = [['story', 'The story'], ['prob', 'Will it succeed?'], ['whatif', 'What if…'], ['horizon', 'Holding period'], ['beh', 'Can you hold it?'], ['owns', 'What it owns'], ['outlook', 'Coming months'], ['stayed', 'Would you have stayed?']];
  window.__rxfFund = function (code) {
    MF.fund = { code: code }; MF.tool = 'story'; MF.cache = { wiMode: 'sip', wiAmt: 10000, wiYear: 2018, hzY: 5 };
    modal(loading('Reading the fund\'s full history…'));
    get('mf/xray/' + code).then(function (d) { MF.fund.x = d; fundView(); }).catch(function (e) { mbody(errBox(e)); });
  };
  window.__rxfTool = function (t) { MF.tool = t; fundView(); };
  function fundView() {
    var x = MF.fund.x, s = x.scheme || {}, code = MF.fund.code;
    var h = '<div style="font-size:17px;font-weight:700;color:var(--text1);padding-right:30px">' + esc(s.scheme_name) + '</div>' +
      '<div class="rx-muted">' + esc([s.amc, s.category].filter(Boolean).join(' · ')) + ' · NAV ' + esc(s.nav_latest) + ' (' + esc(day(s.nav_date)) + ')</div>' + staleNote(s.nav_date, 'NAV') +
      spark(x.nav_series, 'v', 120) +
      '<div style="margin:8px 0 10px;border-bottom:1px solid var(--border);padding-bottom:8px">' + TOOLS.map(function (t) { return pill(t[1], MF.tool === t[0], "window.__rxfTool('" + t[0] + "')"); }).join('') + '</div><div id="rxf-tool"></div>' +
      '<div class="rx-kv" style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">' +
      (x.lumpsum && x.lumpsum.y5 ? '<div class="rx-lv"><div class="t">₹1L over 5 years</div><div class="v">' + inr(x.lumpsum.y5.value_of_1L) + '</div></div>' : '') +
      (x.sip && x.sip.y5 ? '<div class="rx-lv"><div class="t">SIP 5Y XIRR</div><div class="v">' + esc(x.sip.y5.xirr) + '%</div></div>' : '') +
      '<div class="rx-lv"><div class="t">Max fall</div><div class="v" style="color:' + RED + '">' + p(x.drawdown && x.drawdown.max_pct) + '</div></div>' +
      '<div class="rx-lv"><div class="t">Typical yearly swing</div><div class="v">' + p(x.vol_annual_pct) + '</div></div></div>' +
      '<p class="rx-note">' + esc((x.narrative && x.narrative.disclaimer) || 'Research, not advice.') + '</p>';
    mbody(h);
    toolView(code);
  }
  function T(html) { var t = document.getElementById('rxf-tool'); if (t) t.innerHTML = html; }
  function cached(key, path) {
    if (MF.cache[key]) return Promise.resolve(MF.cache[key]);
    return get(path).then(function (d) { MF.cache[key] = d; return d; });
  }
  function toolView(code) {
    var t = MF.tool, x = MF.fund.x, nar = x.narrative || {};
    if (t === 'story') {
      var sec = function (title, body) { return body ? '<div class="rxf-sec">' + title + '</div><div class="rxf-p">' + body + '</div>' : ''; };
      return T(sec('The story so far', esc(nar.story && nar.story[0])) + sec('How consistent is it, really?', esc(nar.consistency)) + sec('The bad times', esc(nar.bad_times)) +
        sec('The SIP reality check', esc(nar.sip_reality)) + sec('Against its category', esc(nar.category_compare)) +
        (nar.suits && nar.suits.length ? sec('Who this fund suits', '<ul style="padding-left:18px">' + nar.suits.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>') : '') || '<div class="rx-muted">No narrative for this fund.</div>');
    }
    T(loading());
    if (t === 'prob') return cached('prob', 'mf/probability/' + code).then(function (d) {
      if (!d.horizons) return T('<div class="rx-muted">' + esc(d.error || 'Unavailable.') + '</div>');
      T('<p class="rxf-p">' + esc(d.conversation) + '</p>' + d.horizons.filter(function (h) { return h.p_positive != null; }).map(function (h) {
        return '<div style="margin:10px 0"><b style="font-size:13px">Hold ' + h.years + ' year' + (h.years === 1 ? '' : 's') + '</b> <span class="rx-muted">' + esc(h.windows) + ' historical windows</span>' +
          [['Ended positive', h.p_positive, TEAL], ['Beat 6% inflation', h.p_beat_inflation, GREEN], ['Beat the Nifty', h.p_beat_benchmark, RED]].map(function (r) {
            return r[1] == null ? '' : '<div class="rxf-row"><span style="width:120px" class="rx-muted">' + r[0] + '</span>' + bar(r[1], r[2]) + '<b style="width:50px;text-align:right">' + r[1] + '%</b></div>';
          }).join('') + '</div>';
      }).join('') + '<p class="rx-note">Counted from every actual window in this fund\'s published history. Benchmark: NIFTYBEES. History never guarantees the future.</p>');
    }).catch(function (e) { T(errBox(e)); });
    if (t === 'whatif') {
      var c = MF.cache, yrs = []; for (var y = 2008; y <= 2025; y++) yrs.push(y);
      T('<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12.5px;margin-bottom:8px"><select id="rxf-wim" class="rx-in" style="text-transform:none;width:auto"><option value="sip"' + (c.wiMode === 'sip' ? ' selected' : '') + '>SIP monthly</option><option value="lumpsum"' + (c.wiMode === 'lumpsum' ? ' selected' : '') + '>Lumpsum once</option></select>' +
        '<input id="rxf-wia" class="rx-in" style="width:110px" type="number" value="' + c.wiAmt + '"><span class="rx-muted">starting</span><select id="rxf-wiy" class="rx-in" style="text-transform:none;width:auto">' +
        yrs.map(function (y) { return '<option' + (y === c.wiYear ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select><button class="rx-go" onclick="window.__rxfWi()">Run</button></div><div id="rxf-wiout"></div>');
      return window.__rxfWi();
    }
    if (t === 'horizon') {
      T('<div class="rxf-row" style="font-size:12.5px"><span class="rx-muted">If you hold</span><input type="range" min="1" max="10" value="' + MF.cache.hzY + '" style="flex:1" onchange="window.__rxfHz(this.value)"><b id="rxf-hzl">' + MF.cache.hzY + ' years</b></div><div id="rxf-hzout"></div>');
      return window.__rxfHz(MF.cache.hzY);
    }
    if (t === 'beh') return cached('beh', 'mf/behaviour/' + code).then(function (d) {
      if (d.score == null) return T('<div class="rx-muted">' + esc(d.error || 'Unavailable.') + '</div>');
      var col = d.score >= 75 ? GREEN : d.score >= 55 ? AMBER : RED;
      T('<div style="display:flex;gap:14px;align-items:center;margin-bottom:10px"><div style="font-size:44px;font-weight:700;color:' + col + '">' + esc(d.score) + '</div><div><b>' + esc(d.band) + '</b><div class="rx-muted" style="max-width:420px">Behaviour score out of 100: how hard this fund has been to stay invested in, from its own history.</div></div></div>' +
        Object.keys(d.sub_scores || {}).map(function (k) { return '<div class="rxf-row"><span style="width:110px;text-transform:capitalize" class="rx-muted">' + esc(k) + '</span>' + bar(d.sub_scores[k]) + '<b style="width:34px;text-align:right">' + esc(d.sub_scores[k]) + '</b></div>'; }).join('') +
        '<p class="rxf-p" style="margin-top:10px">' + esc(d.conversation) + '</p>');
    }).catch(function (e) { T(errBox(e)); });
    if (t === 'owns') return cached('owns', 'mf/holdings-xray/' + code).then(function (d) {
      return get('mf/dna/' + code).catch(function () { return null; }).then(function (dna) {
        if (!d.weighted) return T('<div class="rx-muted">' + esc(d.error || 'Holdings not yet ingested for this fund. The disclosure pipeline covers funds as their AMC workbooks are parsed.') + '</div>');
        var w = d.weighted;
        T('<p class="rxf-p">' + esc(d.conversation) + '</p><div class="rx-kv" style="margin:8px 0">' +
          '<div class="rx-lv"><div class="t">Seen through</div><div class="v">' + esc(d.coverage && d.coverage.equity_wt_pct) + '% of NAV</div></div>' +
          '<div class="rx-lv"><div class="t">Weighted P/E</div><div class="v">' + esc(w.pe == null ? '—' : w.pe) + ' <span class="rx-muted">vs market ' + esc(w.market_median_pe) + '</span></div></div>' +
          '<div class="rx-lv"><div class="t">Weighted P/B</div><div class="v">' + esc(w.pb == null ? '—' : w.pb) + '</div></div><div class="rx-lv"><div class="t">Weighted ROE</div><div class="v">' + p(w.roe) + '</div></div></div>' +
          '<div class="rxf-sec">Top holdings</div>' + (d.top_holdings || []).map(function (h) {
            return '<div class="rxf-row"><span style="flex:2">' + esc(h.name) + (h.symbol ? '' : ' <span class="rx-muted">(foreign or debt)</span>') + '</span>' + bar(Math.min((h.weight_pct || 0) * 10, 100)) +
              '<b style="width:50px;text-align:right">' + esc(h.weight_pct) + '%</b><span class="rx-muted" style="width:60px;text-align:right">' + (h.pe != null ? 'PE ' + Math.round(h.pe) : '—') + '</span><span class="rx-muted" style="width:60px;text-align:right">' + (h.roe != null ? 'ROE ' + Math.round(h.roe) : '—') + '</span></div>';
          }).join('') +
          (dna && dna.factors ? '<div class="rxf-sec">Portfolio DNA (50 = the market\'s middle)</div>' + Object.keys(dna.factors).map(function (k) {
            var v = dna.factors[k]; return '<div class="rxf-row"><span style="width:160px;text-transform:capitalize" class="rx-muted">' + esc(k.replace(/_/g, ' ')) + '</span>' + bar(v, v >= 60 ? TEAL : v >= 40 ? AMBER : RED) + '<b style="width:34px;text-align:right">' + esc(v) + '</b></div>';
          }).join('') + '<div style="font-size:12px;margin-top:4px"><b>' + esc(dna.style) + '</b> · top-10 = ' + esc(dna.concentration_top10_pct) + '% of money</div>' : '') +
          '<p class="rx-note">' + esc(d.disclaimer || '') + ' As of ' + esc(d.as_of) + '.</p>');
      });
    }).catch(function (e) { T(errBox(e)); });
    if (t === 'outlook') return cached('ol', 'mf/forward-outlook/' + code).then(function (d) {
      if (!d.covered) return T('<p class="rxf-p">' + esc(d.note || 'Not covered.') + '</p>');
      var b = d.book || {}, rg = d.regime || {};
      T('<p class="rxf-p">' + esc(d.conversation) + '</p><div class="rx-kv" style="margin:8px 0">' +
        [['Book P/E', b.pe, 'market ' + (b.market_pe_median == null ? '—' : b.market_pe_median)], ['Weighted ROE', b.roe != null ? b.roe + '%' : null, 'market ' + (b.market_roe_median == null ? '—' : b.market_roe_median) + '%'],
          ['EPS growth (book)', b.eps_growth != null ? b.eps_growth + '%' : null, 'held companies, YoY'], ['Holdings momentum', b.momentum_3m != null ? b.momentum_3m + '%' : null, 'market ' + (rg.market_ret3m_median == null ? '—' : rg.market_ret3m_median) + '% over 3 months']].map(function (r) {
          return '<div class="rx-lv"><div class="t">' + r[0] + '</div><div class="v">' + esc(r[1] == null ? '—' : r[1]) + '</div><div class="rx-muted">' + esc(r[2]) + '</div></div>';
        }).join('') + '</div>' + (d.drivers || []).map(function (dr) {
          var c = dr.direction === 'tailwind' ? ['#dcfce7', GREEN] : dr.direction === 'headwind' ? ['#fee2e2', '#b91c1c'] : ['var(--bg1)', 'var(--text3)'];
          return '<div class="rx-card" style="padding:9px 12px;margin:6px 0;display:flex;gap:8px"><span class="rx-chip" style="background:' + c[0] + ';color:' + c[1] + ';height:fit-content">' + esc(dr.direction) + '</span>' +
            '<div><div style="font-size:12.5px;font-weight:600">' + esc(dr.driver) + ' · <span style="font-weight:400">' + esc(dr.reading) + '</span></div><div class="rx-muted">' + esc(dr.receipt) + '</div></div></div>';
        }).join('') + '<p class="rx-note">Holdings as of ' + esc(d.as_of) + ', seeing ' + esc(d.coverage_pct) + '% of the book. ' + esc(d.disclaimer || '') + '</p>');
    }).catch(function (e) { T(errBox(e)); });
    if (t === 'stayed') return cached('st', 'mf/stayed/' + code).then(function (d) {
      if (!d.episodes) return T('<div class="rx-muted">Unavailable.</div>');
      T(d.episodes.map(function (e) {
        return '<div class="rx-card" style="padding:10px 12px;margin:6px 0"><div style="font-size:13px;font-weight:600;margin-bottom:6px">' + esc(e.line) + '</div><div style="display:flex;gap:3px;align-items:flex-end;height:50px">' +
          (e.path || []).map(function (m) { return '<div style="flex:1;text-align:center"><div style="height:' + Math.min(Math.abs(n(m.dd_pct) || 0) * 1.4, 44) + 'px;width:70%;margin:0 auto;background:' + RED + ';opacity:.75;border-radius:2px"></div><div style="font-size:9px" class="rx-muted">' + esc(String(m.d).slice(2)) + '</div></div>'; }).join('') +
          '</div></div>';
      }).join('') + '<p class="rxf-p">' + esc(d.conversation) + '</p>');
    }).catch(function (e) { T(errBox(e)); });
  }
  window.__rxfWi = function () {
    var c = MF.cache, m = document.getElementById('rxf-wim'), a = document.getElementById('rxf-wia'), y = document.getElementById('rxf-wiy'), o = document.getElementById('rxf-wiout');
    if (m) { c.wiMode = m.value; c.wiAmt = Number(a.value) || 10000; c.wiYear = Number(y.value) || 2018; }
    if (!o) return;
    o.innerHTML = loading('Walking the real NAV path…');
    get('mf/whatif/' + MF.fund.code + '?mode=' + c.wiMode + '&amount=' + c.wiAmt + '&start_year=' + c.wiYear).then(function (d) {
      if (!d.conversation) { o.innerHTML = '<div class="rx-muted">' + esc(d.error || 'Unavailable.') + '</div>'; return; }
      var s = d.series || [], svg = '';
      if (s.length > 5) {
        var vmax = Math.max.apply(null, s.map(function (q) { return n(q.value) || 0; }));
        var pl = function (k) { return s.map(function (q, i) { return (i / (s.length - 1) * 640).toFixed(1) + ',' + (125 - (n(q[k]) || 0) / vmax * 115).toFixed(1); }).join(' '); };
        svg = '<svg width="100%" viewBox="0 0 640 135"><polyline points="' + pl('invested') + '" fill="none" stroke="#d5d5d0" stroke-dasharray="4 3" stroke-width="1.5"/><polyline points="' + pl('value') + '" fill="none" stroke="' + TEAL + '" stroke-width="2"/></svg>' +
          '<div class="rx-muted">Solid: the value of your money. Dashed: what you had put in.</div>';
      }
      o.innerHTML = '<p class="rxf-p">' + esc(d.conversation) + '</p>' + svg;
    }).catch(function (e) { o.innerHTML = errBox(e); });
  };
  window.__rxfHz = function (yv) {
    MF.cache.hzY = Number(yv); var l = document.getElementById('rxf-hzl'); if (l) l.textContent = yv + ' years';
    var o = document.getElementById('rxf-hzout'); if (!o) return;
    o.innerHTML = loading('Recomputing every ' + yv + '-year window…');
    get('mf/horizon/' + MF.fund.code + '?years=' + yv).then(function (d) {
      if (!d.conversation) { o.innerHTML = '<div class="rx-muted">' + esc(d.error || 'Unavailable.') + '</div>'; return; }
      var H = d.histogram || [], nmax = Math.max.apply(null, H.map(function (b) { return b.n; }).concat([1]));
      o.innerHTML = '<p class="rxf-p">' + esc(d.conversation) + '</p>' + (H.length ? '<svg width="100%" viewBox="0 0 640 110">' + H.map(function (b, i) {
        return '<rect x="' + (i * (640 / H.length) + 2) + '" y="' + (100 - b.n / nmax * 95) + '" width="' + (640 / H.length - 4) + '" height="' + (b.n / nmax * 95) + '" rx="2" fill="' + (b.to <= 0 ? RED : TEAL) + '" opacity="' + (b.to <= 0 ? 0.8 : 0.55) + '"/>';
      }).join('') + '</svg>' : '') + '<div class="rx-muted">Every ' + esc(d.years) + '-year outcome in this fund\'s history (' + esc(d.windows) + ' windows). Red bars ended negative. Median ' + esc(d.median) + '%, worst ' + esc(d.worst) + '%, best ' + esc(d.best) + '%.</div>';
    }).catch(function (e) { o.innerHTML = errBox(e); });
  };
  function dnaBoard() {
    var b = document.getElementById('rxf-mfbody');
    var F = ['value', 'growth', 'quality', 'balance_sheet_safety', 'size'], L = { value: 'Value', growth: 'Growth', quality: 'Quality', balance_sheet_safety: 'Safety', size: 'Size' };
    b.innerHTML = '<p class="rx-lead">Every fund fingerprinted by <b>what it actually owns</b>: each disclosed holding is percentile-ranked against the listed universe, then blended by portfolio weight. 50 on any factor is the market\'s middle. Click a fund for its full story.</p>' +
      '<div>' + [['value', 'Deepest value'], ['quality', 'Highest quality'], ['safety', 'Safest balance sheets'], ['concentration', 'Most concentrated']].map(function (s) {
        return pill(s[1], MF.dnaSort === s[0], "window.__rxfDna('" + s[0] + "')");
      }).join('') + '</div><div id="rxf-dna">' + loading('Fingerprinting the covered funds…') + '</div>';
    get('mf/dna-board?sort=' + MF.dnaSort + '&limit=50').then(function (d) {
      var rs = d.results || [];
      document.getElementById('rxf-dna').innerHTML = !rs.length ? '<div class="empty">' + esc(d.note || 'No covered funds yet.') + '</div>' :
        '<div class="rx-scroll"><table class="rx-tbl"><tr><th>Fund</th>' + F.map(function (f) { return '<th style="text-align:center">' + L[f] + '</th>'; }).join('') + '<th>Top 10</th></tr>' +
        rs.map(function (r) {
          return '<tr style="cursor:pointer" onclick="window.__rxfFund(' + r.scheme_code + ')"><td><b style="color:' + TEAL + '">' + esc(String(r.scheme_name).split(' - ')[0]) + '</b><div class="rx-muted">' + esc(r.style) + ' · sees ' + esc(r.coverage_pct) + '% of NAV · as of ' + esc(r.as_of) + '</div></td>' +
            F.map(function (f) { var v = r.factors && r.factors[f]; return '<td style="width:90px"><div class="rxf-row" style="margin:0">' + bar(v, v >= 60 ? TEAL : v >= 40 ? AMBER : RED) + '</div><div style="text-align:center;font-size:11px">' + esc(v == null ? '—' : v) + '</div></td>'; }).join('') +
            '<td>' + esc(r.concentration_top10_pct) + '%</td></tr>';
        }).join('') + '</table></div><p class="rx-note">' + esc(d.note || '') + '</p>';
    }).catch(function (e) { document.getElementById('rxf-dna').innerHTML = errBox(e); });
  }
  window.__rxfDna = function (s) { MF.dnaSort = s; dnaBoard(); };

  /* ════════════════════ ETFs ════════════════════ */
  var EF = { q: '', sort: 'turnover', yrs: null, risk: null };
  var ECOLL = [['Most liquid', '', 'turnover'], ['Premium trap board', '', 'prem_disc'], ['Strongest 3Y records', '', 'roll3_median'], ['Gold and silver', 'gold', 'turnover'], ['International', 'nasdaq', 'prem_disc'], ['Cash that earns', 'liquid', 'turnover']];
  function premColor(v) { v = n(v); return v == null ? '' : Math.abs(v) < 0.3 ? GREEN : Math.abs(v) < 1 ? AMBER : RED; }
  function etfHome() {
    box('etfresearch').innerHTML = '<h2 style="margin:0">ETFs</h2><p class="rx-lead">The number ETF buyers should always check: <b>premium or discount to NAV</b>. Click any ETF for its premium history over the last year.</p>' +
      '<div class="rx-card" style="margin-bottom:14px"><b style="color:' + TEAL + '">Find my ETF: two questions, a reasoned mix</b>' +
      '<div style="margin-top:8px"><span class="rx-muted" style="display:inline-block;width:200px">When is this money needed?</span>' + [['Under 2 years', 1], ['2 to 5 years', 3.5], ['5+ years', 7]].map(function (o) { return pill(o[0], EF.yrs === o[1], 'window.__rxfWzY(' + o[1] + ')'); }).join('') + '</div>' +
      '<div><span class="rx-muted" style="display:inline-block;width:200px">If ₹1L became ₹70K for a year:</span>' + [['I would sell', 'panic'], ['Hold, uncomfortably', 'hold'], ['Buy more', 'buymore']].map(function (o) { return pill(o[0], EF.risk === o[1], "window.__rxfWzR('" + o[1] + "')"); }).join('') + '</div>' +
      '<div id="rxf-wz" class="rx-muted" style="margin-top:6px">Answer both and the mix appears.</div></div>' +
      '<div><span class="rx-muted" style="font-weight:700;text-transform:uppercase;font-size:10.5px;margin-right:6px">Collections</span>' + ECOLL.map(function (c, i) { return '<button class="rxf-pill col" onclick="window.__rxfEColl(' + i + ')">' + c[0] + '</button>'; }).join('') + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin:6px 0 12px;flex-wrap:wrap"><input id="rxf-eq" class="rx-in" style="text-transform:none;width:240px" placeholder="Filter (gold, nifty, liquid…)" value="' + esc(EF.q) + '" onkeydown="if(event.key===\'Enter\')window.__rxfEScan()">' +
      '<select id="rxf-es" class="rx-in" style="text-transform:none;width:auto" onchange="window.__rxfEScan()">' + [['turnover', 'Sort: liquidity'], ['prem_disc', 'Sort: widest premium or discount'], ['roll3_median', 'Sort: median 3Y (rolling)']].map(function (o) {
        return '<option value="' + o[0] + '"' + (EF.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select><button class="rx-go" onclick="window.__rxfEScan()">Scan</button></div><div id="rxf-etbl"></div>';
    etfLoad();
  }
  window.__rxfEColl = function (i) { EF.q = ECOLL[i][1]; EF.sort = ECOLL[i][2]; etfHome(); };
  window.__rxfEScan = function () { EF.q = document.getElementById('rxf-eq').value; EF.sort = document.getElementById('rxf-es').value; etfLoad(); };
  function etfLoad() {
    var t = document.getElementById('rxf-etbl'); t.innerHTML = loading('Reading the ETF universe…');
    get('etf/screener?underlying=' + encodeURIComponent(EF.q) + '&sort=' + EF.sort + '&limit=60').then(function (d) {
      var rs = d.results || [];
      if (!rs.length) { t.innerHTML = '<div class="empty">Nothing matched.</div>'; return; }
      var navNewest = rs.map(function (r) { return r.nav_date; }).filter(Boolean).sort().slice(-1)[0];
      var priceNewest = rs.map(function (r) { return r.trade_date; }).filter(Boolean).sort().slice(-1)[0];
      var gap = navNewest && priceNewest ? Math.round((new Date(priceNewest) - new Date(navNewest)) / 864e5) : 0;
      t.innerHTML = (gap > 5 ? '<div class="rx-flag" style="background:#fff7ed;color:#9a3412">NAVs are as of ' + esc(navNewest) + ' but prices are as of ' + esc(priceNewest) +
        '. The premium or discount column compares prices and NAVs from different dates, so treat it as unreliable until NAVs are current.</div>' : '') +
        '<div class="rx-scroll"><table class="rx-tbl"><tr><th>ETF</th><th>Price</th><th>NAV</th><th>Premium / discount</th><th>Turnover</th><th>1Y</th><th>Median 3Y (rolling)</th></tr>' +
        rs.map(function (r) {
          return '<tr class="rx-row" onclick="window.__rxfEtf(\'' + esc(r.symbol) + '\')"><td><b style="color:' + TEAL + '">' + esc(r.symbol) + '</b><div class="rx-muted">' + esc(String(r.scheme_name || r.name || '').slice(0, 50)) + '</div></td>' +
            '<td>' + esc(r.close) + '<div class="rx-muted">' + esc(day(r.trade_date)) + '</div></td><td>' + esc(r.nav == null ? '—' : r.nav) + '<div class="rx-muted">' + esc(day(r.nav_date)) + '</div></td>' +
            '<td style="font-weight:700;color:' + premColor(r.prem_disc) + '">' + p(r.prem_disc, true) + '</td><td>' + (r.turnover ? '₹' + (r.turnover / 1e7).toFixed(1) + ' cr' : '—') + '</td><td>' + p(r.ret_1y) + '</td><td>' + p(r.roll3_median) + '</td></tr>';
        }).join('') + '</table></div><p class="rx-note">' + esc(d.note || '') + ' Research, not advice.</p>';
    }).catch(function (e) { t.innerHTML = errBox(e); });
  }
  window.__rxfWzY = function (y) { EF.yrs = y; etfHome(); wz(); };
  window.__rxfWzR = function (r) { EF.risk = r; etfHome(); wz(); };
  function wz() {
    if (EF.yrs == null || !EF.risk) return;
    var o = document.getElementById('rxf-wz'); o.innerHTML = loading('Working the buckets…');
    get('etf/chooser?years=' + EF.yrs + '&risk=' + EF.risk).then(function (d) {
      o.innerHTML = (d.allocation || []).map(function (a) {
        return '<div style="display:flex;gap:12px;padding:8px 0;border-top:1px solid var(--border)"><div style="width:64px"><div style="font-size:19px;font-weight:700;color:' + TEAL + '">' + esc(a.weight_pct) + '%</div>' + bar(a.weight_pct) + '</div>' +
          '<div style="flex:1;font-size:12.5px;color:var(--text2)"><a href="javascript:void(0)" onclick="window.__rxfEtf(\'' + esc(a.pick.symbol) + '\')" style="font-weight:700;color:' + TEAL + '">' + esc(a.pick.symbol) + '</a> <span class="rx-muted" style="text-transform:capitalize">' + esc(a.bucket) + '</span>' +
          '<div>' + esc(a.why) + '. <span class="rx-muted">' + esc(a.pick.receipt || '') + '.' + (a.alternative ? ' Alternative: ' + esc(a.alternative.symbol) + '.' : '') + '</span></div>' + (a.warning ? '<div style="color:' + RED + '">' + esc(a.warning) + '</div>' : '') + '</div></div>';
      }).join('') + '<p class="rx-note">' + esc(d.conversation || '') + '</p>';
    }).catch(function (e) { o.innerHTML = errBox(e); });
  }
  window.__rxfEtf = function (sym) {
    modal(loading('Reading a year of price against NAV…'));
    get('etf/detail/' + encodeURIComponent(sym)).then(function (d) {
      var code = d.scheme_code;
      return Promise.all([code ? get('mf/behaviour/' + code).catch(function () { return null; }) : null, code ? get('mf/probability/' + code).catch(function () { return null; }) : null]).then(function (x) {
        var beh = x[0], prob = x[1];
        mbody('<div style="font-size:16px;font-weight:700;padding-right:30px">' + esc(sym) + ': what you pay against what it is worth</div>' +
          (d.conversation ? '<p class="rxf-p">' + esc(d.conversation) + '</p>' : '<div class="rx-muted">' + esc(d.error || 'Unavailable.') + '</div>') +
          spark(d.series, 'prem', 120, TEAL, true) + '<div class="rx-muted">Daily premium or discount over the last year. The dashed line is fair value: above it buyers overpaid.</div>' +
          '<div style="display:flex;gap:18px;font-size:12.5px;margin:10px 0"><span>Average <b>' + esc(d.premium_avg_pct) + '%</b></span><span>Widest day <b style="color:' + RED + '">' + esc(d.premium_worst_pct) + '%</b></span></div>' +
          (beh && beh.score != null ? '<div style="display:flex;gap:10px;align-items:center;border-top:1px solid var(--border);padding-top:10px"><div style="font-size:32px;font-weight:700;color:' + (beh.score >= 75 ? GREEN : beh.score >= 55 ? AMBER : RED) + '">' + esc(beh.score) + '</div>' +
            '<div class="rxf-p" style="font-size:12px"><b>' + esc(beh.band) + '</b>: deepest fall ' + esc(beh.receipts && beh.receipts.max_drawdown_pct) + '%, yearly swings about ' + esc(beh.receipts && beh.receipts.annual_volatility_pct) + '%.</div></div>' : '') +
          ((prob && prob.horizons) || []).filter(function (h) { return (h.years === 3 || h.years === 5) && h.p_positive != null; }).map(function (h) {
            return '<div class="rxf-row"><span class="rx-muted" style="width:100px">Hold ' + h.years + ' years</span>' + bar(h.p_positive) + '<b style="width:150px;text-align:right">' + h.p_positive + '% ended positive</b></div>';
          }).join('') + (code ? '<div style="margin-top:12px"><button class="btn btn-s" onclick="window.__rxfFund(' + code + ')">Full fund research →</button></div>' : ''));
      });
    }).catch(function (e) { mbody(errBox(e)); });
  };

  /* ════════════════════ BONDS ════════════════════ */
  var BD = { tab: 'sgb', d: null, yld: null, shift: null };
  function bondsHome() {
    box('bondsresearch').innerHTML = '<h2 style="margin:0">Bonds</h2><p class="rx-lead">Exchange-traded debt: <b>Sovereign Gold Bonds</b>, <b>government securities</b> with the yield curve drawn, and <b>corporate bonds and T-bills</b>. Retail volumes are thin, so the volume column is part of the analysis.</p>' +
      '<div id="rxf-btabs"></div><div id="rxf-bbody">' + loading('Reading the debt board…') + '</div>';
    Promise.all([get('debt/board').catch(function () { return {}; }), get('debt/yields').catch(function () { return null; }), get('debt/curve-shift').catch(function () { return null; })])
      .then(function (x) { BD.d = x[0]; BD.yld = x[1]; BD.shift = x[2]; bondsView(); });
  }
  window.__rxfBTab = function (t) { BD.tab = t; bondsView(); };
  function bondsView() {
    document.getElementById('rxf-btabs').innerHTML = [['sgb', 'Sovereign Gold Bonds'], ['gsec', 'G-Secs and the curve'], ['corp', 'Corporate and T-Bills']].map(function (t) { return pill(t[1], BD.tab === t[0], "window.__rxfBTab('" + t[0] + "')"); }).join('');
    var d = BD.d || {}, h = '', b = document.getElementById('rxf-bbody');
    if (BD.tab === 'sgb') {
      var s = d.sgb || {}, rs = s.results || [];
      var tr = rs.filter(function (r) { return r.vs_median_pct != null && (r.volume || 0) > 0; });
      var cheap = tr.length ? tr.reduce(function (a, c) { return a.vs_median_pct < c.vs_median_pct ? a : c; }) : null;
      h = '<p class="rxf-p">' + esc(s.note || '') + ' Median price: <b>' + inr(s.median_price) + '</b>.</p>' +
        (cheap ? '<div class="rx-flag" style="background:#eef4f5;color:var(--text2)">Same gold, different prices: <b>' + esc(cheap.symbol) + '</b>' + (cheap.maturity_year ? ' (matures ' + esc(cheap.maturity_year) + ')' : '') + ' traded ' + Math.abs(cheap.vs_median_pct) +
          '% below the series median today with real volume. Every SGB also pays 2.5% a year on issue price. Thin volumes: use limit orders.</div>' : '') +
        '<div class="rx-scroll"><table class="rx-tbl"><tr><th>SGB series</th><th>Maturity</th><th>Price</th><th>vs median</th><th>Volume</th></tr>' + rs.map(function (r) {
          return '<tr><td><b>' + esc(r.symbol) + '</b></td><td>' + esc(r.maturity_year == null ? '—' : r.maturity_year) + '</td><td>' + inr(r.close) + '</td><td style="font-weight:700;color:' + (r.vs_median_pct < -1 ? GREEN : r.vs_median_pct > 1 ? RED : 'var(--text3)') + '">' + p(r.vs_median_pct, true) + '</td><td>' + esc(r.volume || 0) + '</td></tr>';
        }).join('') + '</table></div>';
    } else if (BD.tab === 'gsec') {
      var g = d.gsec || {}, gr = g.results || [], sh = BD.shift;
      h = '<p class="rxf-p">' + esc(g.note || '') + '</p>';
      if (sh && sh.avg_bps != null) h += '<div class="rx-flag" style="background:#eef4f5;color:var(--text2)">Over the last ' + esc(sh.days_span) + ' days, traded G-sec yields have moved <b style="color:' + (sh.avg_bps > 0 ? RED : GREEN) + '">' + (sh.avg_bps > 0 ? 'up ' : 'down ') + Math.abs(sh.avg_bps) + ' bps</b> on average across ' + esc(sh.symbols) + ' papers' +
        (sh.long_bps != null ? ' (long end ' + (sh.long_bps > 0 ? '+' : '') + sh.long_bps + ' bps, short end ' + (sh.short_bps > 0 ? '+' : '') + sh.short_bps + ' bps)' : '') + '.</div>';
      var pts = gr.filter(function (r) { return r.ytm_approx != null && r.maturity_year != null && r.volume > 0; });
      if (pts.length >= 4) {
        var xs = pts.map(function (r) { return r.maturity_year; }), ys = pts.map(function (r) { return r.ytm_approx; });
        var mnX = Math.min.apply(null, xs), mxX = Math.max.apply(null, xs), mnY = Math.min.apply(null, ys) - 0.3, mxY = Math.max.apply(null, ys) + 0.3;
        var X = function (v) { return 30 + (v - mnX) / (mxX - mnX || 1) * 590; }, Y = function (v) { return 130 - (v - mnY) / (mxY - mnY || 1) * 115; };
        var srt = pts.slice().sort(function (a, c) { return a.maturity_year - c.maturity_year; });
        h += '<div class="rx-card" style="margin:10px 0"><div class="rxf-sec" style="margin-top:0">The yield curve, drawn from traded prices</div><svg width="100%" viewBox="0 0 640 150"><polyline fill="none" stroke="' + TEAL + '" stroke-width="1.5" opacity=".5" points="' +
          srt.map(function (r) { return X(r.maturity_year) + ',' + Y(r.ytm_approx); }).join(' ') + '"/>' + pts.map(function (r) { return '<circle cx="' + X(r.maturity_year) + '" cy="' + Y(r.ytm_approx) + '" r="3.5" fill="' + RED + '" opacity=".8"><title>' + esc(r.symbol) + ': ' + r.ytm_approx + '% (' + r.maturity_year + ')</title></circle>'; }).join('') +
          [mnX, Math.round((mnX + mxX) / 2), mxX].map(function (yr) { return '<text x="' + X(yr) + '" y="147" text-anchor="middle" font-size="10" fill="#8a8a85">' + yr + '</text>'; }).join('') +
          [mnY + 0.3, mxY - 0.3].map(function (v) { return '<text x="2" y="' + (Y(v) + 3) + '" font-size="10" fill="#8a8a85">' + v.toFixed(1) + '%</text>'; }).join('') + '</svg><div class="rx-muted">Each dot is a traded G-sec: maturity year against approximate yield to maturity.</div></div>';
      }
      h += '<div class="rx-scroll"><table class="rx-tbl"><tr><th>G-Sec</th><th>Price</th><th>Coupon</th><th>Maturity</th><th>YTM (approx)</th><th>Volume</th></tr>' + gr.map(function (r) {
        return '<tr><td><b>' + esc(r.symbol) + '</b></td><td>' + inr(r.close) + '</td><td>' + p(r.coupon) + '</td><td>' + esc(r.maturity_year == null ? '—' : r.maturity_year) + '</td><td><b>' + p(r.ytm_approx) + '</b></td><td>' + esc(r.volume || 0) + '</td></tr>';
      }).join('') + '</table></div>';
    } else {
      var c = d.corp || {}, y = BD.yld;
      h = '<p class="rxf-p">' + esc(c.note || '') + '</p>';
      if (y && y.risk_free_line) {
        h += '<div class="rx-card" style="margin:10px 0"><div class="rxf-sec" style="margin-top:0">The rate board: India\'s risk-free rate from traded prices</div><div style="font-size:18px;font-weight:700">' + esc(y.risk_free_line) + '</div>' +
          (y.conversation ? '<p class="rxf-p">' + esc(y.conversation) + '</p>' : '') + '<div class="rxf-sec">Corporate yields and the price of credit</div><table class="rx-tbl"><tr><th>Bond</th><th>Coupon</th><th>Maturity</th><th>YTM (approx)</th><th>vs sovereign</th><th>Volume</th></tr>' +
          (y.corp || []).slice(0, 12).map(function (r) {
            return '<tr><td><b>' + esc(r.symbol) + '</b>' + (r.spread_bps != null && r.spread_bps < -80 ? ' <span class="rx-muted">(likely tax-free)</span>' : '') + '</td><td>' + p(r.coupon_pct) + '</td><td>' + esc(r.maturity_year) + '</td><td><b>' + p(r.ytm_approx) + '</b></td>' +
              '<td style="font-weight:700;color:' + (r.spread_bps == null ? 'var(--text3)' : r.spread_bps > 150 ? RED : r.spread_bps < -80 ? GREEN : 'var(--text2)') + '">' + (r.spread_bps != null ? (r.spread_bps > 0 ? '+' : '') + r.spread_bps + ' bps' : '—') + '</td><td>' + esc(r.volume) + '</td></tr>';
          }).join('') + '</table><p class="rx-note">' + esc(y.disclaimer || '') + ' As of ' + esc(y.as_of) + '. T-bill yields come from thin trades and can jump between days.</p></div>';
      }
      h += '<div class="rx-scroll"><table class="rx-tbl"><tr><th>Instrument</th><th>Series</th><th>Last price</th><th>Volume</th><th>Last traded</th></tr>' + (c.results || []).map(function (r) {
        return '<tr><td><b>' + esc(r.symbol) + '</b></td><td>' + esc(r.series) + '</td><td>' + inr(r.close) + '</td><td>' + esc(r.volume || 0) + '</td><td class="rx-muted">' + esc(day(r.trade_date)) + '</td></tr>';
      }).join('') + '</table></div><p class="rx-note">Symbols carry the terms: 91D280826 is a 91-day T-bill maturing 28-08-26; 871REC28 is a REC 8.71% bond maturing 2028.</p>';
    }
    b.innerHTML = h + '<p class="rx-note">Data: NSE daily bhavcopy and the UDiFF segment file. Research, not advice.</p>';
  }

  /* ════════════════════ INSURANCE ════════════════════ */
  var IN = { qs: [], i: 0, ans: {}, started: false, result: null, busy: false };
  var TONE = { 'critical gap': ['#fef2f2', '#991b1b'], 'gap': ['#fff7ed', '#9a3412'], 'partly covered': ['#fefce8', '#854d0e'], 'covered': ['#f0fdf4', '#166534'], 'not assessed': ['#f1f5f9', '#475569'] };
  function insHome() {
    IN = { qs: IN.qs, i: 0, ans: {}, started: false, result: null, busy: false };
    if (!IN.qs.length) get('insurance/questions').then(function (d) { IN.qs = d.questions || []; insView(); }).catch(function (e) { box('insurance').innerHTML = errBox(e); });
    insView();
  }
  function rs(v) { v = n(v); return v == null ? '—' : v >= 100000 ? 'Rs ' + (v / 100000).toFixed(1) + 'L' : 'Rs ' + v.toLocaleString('en-IN'); }
  function insView() {
    var el = box('insurance');
    if (!IN.started && !IN.result) {
      el.innerHTML = '<div style="max-width:720px"><h2 style="margin:0 0 8px">What insurance do you actually need?</h2><p class="rxf-p">Most insurance advice starts with a product and works backwards. This starts with you: what you earn, who depends on it, what you owe and what you own. ' +
        'It works out which risks you actually carry. Some you will already have covered. Some you will not have thought about.</p><p class="rxf-p"><b>Twelve questions.</b> Two are needed; the rest you can skip. Anything you leave out, the assessment says what it could not judge, rather than guessing.</p>' +
        '<div class="rx-card" style="margin:12px 0"><span class="rxf-p" style="font-size:12.5px"><b>We do not sell insurance.</b> We earn nothing on any policy and recommend none. Where IRDAI requires every insurer to offer a standard product with identical wording, we name it, so you can compare on price and claim record.</span></div>' +
        '<button class="rx-go" onclick="window.__rxfInsStart()"' + (IN.qs.length ? '' : ' disabled') + '>Start</button></div>';
      return;
    }
    if (IN.busy) { el.innerHTML = loading('Working out what you are exposed to…'); return; }
    if (!IN.result) {
      var q = IN.qs[IN.i]; if (!q) return;
      var input = q.type === 'bool' ? '<button class="btn btn-s" style="padding:8px 22px" onclick="window.__rxfAns(true)">Yes</button> <button class="btn btn-s" style="padding:8px 22px" onclick="window.__rxfAns(false)">No</button>'
        : q.type === 'choice' ? (q.options || []).map(function (o, k) { return '<button class="btn btn-s" style="display:block;width:100%;max-width:420px;text-align:left;padding:10px 14px;margin:6px 0;font-size:13px" onclick="window.__rxfAnsOpt(' + k + ')">' + esc(o[1]) + '</button>'; }).join('')
          : '<input id="rxf-insv" class="rx-in" style="width:220px" type="number" placeholder="' + (q.type === 'money' ? 'amount in rupees' : esc(q.unit || '')) + '" onkeydown="if(event.key===\'Enter\')window.__rxfAnsNum()"> <button class="rx-go" onclick="window.__rxfAnsNum()">Next</button>';
      el.innerHTML = '<div style="max-width:720px"><div style="display:flex;justify-content:space-between" class="rx-muted"><b style="text-transform:uppercase;font-size:11px">' + esc(q.step_title) + '</b><span>' + q.n + ' of ' + q.of + '</span></div>' +
        '<div style="height:4px;background:var(--bg1);border-radius:3px;margin:6px 0 16px"><div style="height:4px;border-radius:3px;background:' + TEAL + ';width:' + (q.n / q.of * 100) + '%"></div></div>' +
        '<h3 style="margin:0 0 6px;font-size:19px">' + esc(q.q) + '</h3>' + (q.hint ? '<div class="rx-muted" style="margin-bottom:10px">' + esc(q.hint) + '</div>' : '') + '<div style="margin:10px 0 14px">' + input + '</div>' +
        (q.why ? '<div class="rx-muted" style="max-width:520px;margin-bottom:16px">' + esc(q.why) + '</div>' : '') +
        '<div style="display:flex;gap:16px;font-size:12.5px">' + (IN.i > 0 ? '<a href="javascript:void(0)" onclick="window.__rxfInsBack()">← Back</a>' : '') + (!q.required ? '<a href="javascript:void(0)" class="rx-muted" onclick="window.__rxfInsSkip()">Skip this one</a>' : '') + '</div></div>';
      var iv = document.getElementById('rxf-insv'); if (iv) iv.focus();
      return;
    }
    var r = IN.result;
    if (r.error) { el.innerHTML = errBox(r.error); return; }
    var comp = r.completeness || {};
    var h = '<div style="max-width:860px"><h2 style="margin:0 0 8px">Your protection map</h2><p class="rxf-p" style="font-size:14px">' + esc(r.opening) + '</p>' +
      '<div class="rx-card" style="display:flex;gap:14px;margin:10px 0"><div style="text-align:center"><div style="font-size:22px;font-weight:700;color:' + TEAL + '">' + esc(comp.pct) + '%</div><div class="rx-muted" style="font-size:10px">ANSWERED</div></div>' +
      '<div class="rxf-p" style="font-size:12.5px">' + esc(comp.note || '') + (r.blind_spots ? '<div class="rx-muted" style="margin-top:4px">Because of what was left blank, this cannot speak to: ' + esc(r.blind_spots.items.slice(0, 3).join('; ')) + (r.blind_spots.items.length > 3 ? ', and ' + (r.blind_spots.items.length - 3) + ' more' : '') + '.</div>' : '') + '</div></div>';
    var sc = r.scenarios && r.scenarios.scenarios;
    if (sc && sc.length) h += '<h3>What would actually happen</h3>' + sc.map(function (s) {
      return '<div style="border-left:2px solid rgba(15,76,92,.3);padding:4px 0 4px 14px;margin:8px 0"><b>' + esc(s.event) + '</b> <span class="rx-chip" style="background:var(--bg1);color:var(--text2)">' + esc(s.verdict) + '</span><div class="rxf-p">' + esc(s.narrative) + '</div></div>';
    }).join('') + '<p class="rx-note">' + esc(r.scenarios.basis || '') + '</p>';
    h += '<h3>Risk by risk</h3>' + (r.risks || []).map(function (k) {
      var t = TONE[k.direction] || TONE.gap;
      return '<div class="rx-card" style="margin:8px 0"><div style="display:flex;justify-content:space-between;gap:12px"><div><b style="font-size:14.5px">' + esc(k.risk) + '</b> <span class="rx-chip" style="background:' + t[0] + ';color:' + t[1] + '">' + esc(k.direction) + '</span> <span class="rx-muted">' + esc(k.category) + '</span>' +
        '<div class="rx-muted" style="margin-top:3px">' + esc(k.reading) + '</div></div>' + (k.cost_text ? '<div style="text-align:right;white-space:nowrap"><div class="rx-muted" style="font-size:10px">COSTS ABOUT</div><b>' + rs(k.cost_low) + ' – ' + rs(k.cost_high).replace('Rs ', '') + '</b><div class="rx-muted" style="font-size:10px">per year</div></div>' : k.direction === 'covered' ? '<span style="color:#166534;font-size:12px;font-weight:600">no action needed</span>' : '') + '</div>' +
        '<p class="rxf-p">' + esc(k.narrative) + '</p>' + (k.where_to_find ? '<p class="rxf-p" style="font-size:12.5px">' + esc(k.where_to_find) + '</p>' : '') + (k.tax ? '<p class="rxf-p" style="font-size:12px;border-left:2px solid var(--border);padding-left:10px"><b>Tax: </b>' + esc(k.tax) + '</p>' : '') +
        (k.irdai_standard ? '<span class="rx-chip" style="background:var(--bg1);color:var(--text2)">IRDAI standard product: ' + esc(k.irdai_standard) + '</span>' : '') + '</div>';
    }).join('');
    var ap = r.action_plan;
    if (ap && ap.steps && ap.steps.length) h += '<div class="rx-card" style="border:2px solid rgba(15,76,92,.2);margin-top:18px"><h3 style="margin-top:0">What to do about it</h3><p class="rxf-p">' + esc(ap.narrative) + '</p>' +
      '<table class="rx-tbl">' + ap.steps.map(function (s, i) { return '<tr><td style="width:20px" class="rx-muted">' + (i + 1) + '</td><td><b>' + esc(s.action) + '</b>' + (s.irdai_standard ? '<div class="rx-muted">IRDAI standard: ' + esc(s.irdai_standard) + '</div>' : '') + '</td><td>' + esc(s.cost_text) + '</td></tr>'; }).join('') + '</table>' +
      (ap.total_annual_low ? '<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px"><b>All of it, per year</b><b>Rs ' + Number(ap.total_annual_low).toLocaleString('en-IN') + ' – ' + Number(ap.total_annual_high).toLocaleString('en-IN') +
        (ap.pct_of_income_low != null ? ' <span class="rx-muted" style="font-weight:400">(' + ap.pct_of_income_low + '–' + ap.pct_of_income_high + '% of income)</span>' : '') + '</b></div>' : '') +
      '<p class="rx-note">' + esc(ap.where_to_buy || '') + ' ' + esc(ap.cost_basis || '') + '</p></div>';
    var cr = r.claim_risks;
    if (cr && cr.causes && cr.causes.length) h += '<h3>How claims get lost</h3><p class="rxf-p">' + esc(cr.opening) + '</p>' + cr.causes.map(function (c) {
      return '<div class="rx-card" style="margin:8px 0"><b>' + esc(c.cause) + '</b> <span class="rx-chip" style="background:#f0fdf4;color:#166534">' + esc(c.control) + '</span><p class="rxf-p" style="font-size:12.5px">' + esc(c.what_happens) + '</p>' +
        '<p class="rxf-p" style="font-size:12.5px"><b>What to do: </b>' + esc(c.what_to_do) + '</p><div class="rx-muted">' + esc(c.timing) + '</div></div>';
    }).join('') + '<p class="rx-note">' + esc(cr.note || '') + '</p>';
    el.innerHTML = h + '<p class="rx-note">' + esc(r.disclaimer || '') + '</p><button class="btn btn-s" onclick="window.__rxfInsReset()">Start again</button></div>';
  }
  window.__rxfInsStart = function () { IN.started = true; IN.i = 0; insView(); };
  window.__rxfInsReset = function () { insHome(); };
  window.__rxfInsBack = function () { if (IN.i > 0) IN.i--; insView(); };
  window.__rxfInsSkip = function () { next(); };
  function setAns(k, v) { if (k.indexOf('.') > 0) { var a = k.split('.'); IN.ans[a[0]] = IN.ans[a[0]] || {}; IN.ans[a[0]][a[1]] = v; } else IN.ans[k] = v; }
  function next() {
    if (IN.i + 1 < IN.qs.length) { IN.i++; insView(); return; }
    IN.busy = true; insView();
    post('insurance/protection-map', IN.ans).then(function (d) { IN.result = d; }).catch(function (e) { IN.result = { error: e.message || String(e) }; })
      .then(function () { IN.busy = false; insView(); });
  }
  function answer(v) {
    var q = IN.qs[IN.i]; if (!q) return;
    setAns(q.k, v);
    if (q.k === 'employment' && v) {
      var keep = IN.i;
      get('insurance/questions?employment=' + encodeURIComponent(v)).then(function (d) { if (d.questions && d.questions.length) IN.qs = d.questions; IN.i = keep; next(); }).catch(function () { next(); });
      return;
    }
    next();
  }
  window.__rxfAns = function (v) { answer(v); };
  window.__rxfAnsOpt = function (k) { var q = IN.qs[IN.i]; answer(q.options[k][0]); };
  window.__rxfAnsNum = function () { var v = document.getElementById('rxf-insv').value; if (v !== '' && isFinite(Number(v))) answer(Number(v)); };

  function start() {
    if (!install()) { setTimeout(start, 300); return; }
    wrapNav();
    setTimeout(wrapNav, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
