/* DYOR: AlphaLab pages (Stock 360, Charts, Proof, Bases, Pattern gallery, Screens, Alpha Signal, Options Lab, CAS check, Planning,
   Portfolio Guide, Telegram alerts, Reports) shown inside DYOR. Loaded by /var/www/dyor.html from
   /dyor/api/alphalab/ui.js. The backend signs the person in to AlphaLab and returns the address to frame. */
(function () {
  if (window.__alLoaded) return;
  window.__alLoaded = true;
  var API = '/dyor/api/alphalab/';
  var GROUPS = [
    ['ng-alproof', 'ASK PROOF', [['proof', 'Proof']]],
    ['ng-allab', 'ALPHALAB TOOLS', [['bases', 'Bases'], ['gallery', 'Pattern Gallery'], ['screens', 'Screens'], ['alphasignal', 'Alpha Signal'],
      ['optionslab', 'Options Lab'], ['cascheck', 'CAS Check'], ['telegram', 'Telegram Alerts']]],
    ['ng-alplan', 'PLANNING', [['planning', 'Goal Planning'], ['portfolioguide', 'Portfolio Guide']]],
    ['ng-alrep', 'ADVISOR REPORTS', [['rep_sebi', 'SEBI Research Report'], ['rep_client', 'Client Report'], ['rep_dossier', 'Dossier']]]
  ];
  var access = null, loaded = {};
  /* stock pages that take a symbol (?sym=) and where they live on AlphaLab */
  var AL = 'https://testalpha.in', SYM_PAGES = { stock360: '/new/dashboard/equities', charts: '/new/dashboard/charts' };
  var signedIn = 0, pending = {};
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var st = document.createElement('style');
  st.textContent = '.al-panel{padding:0 !important;overflow:hidden !important}.al-frame{border:0;width:100%;height:100%;display:block;background:var(--bg)}' +
    '.al-msg{max-width:560px;margin:60px auto;padding:28px;border:1px solid var(--border);border-radius:10px;background:var(--bg2);text-align:center;font-size:13px;color:var(--text2);line-height:1.6}';
  document.head.appendChild(st);

  function install() {
    var anchor = document.getElementById('ng-portfolio'), host = document.getElementById('p-emerging');
    if (!anchor || !host) return false;
    if (document.getElementById('ng-allab')) return true;
    GROUPS.forEach(function (g) {
      var el = document.createElement('div');
      el.className = 'nav-group'; el.id = g[0];
      el.innerHTML = '<div class="nav-group-header" onclick="toggleNavGroup(\'' + g[0] + '\')">' + g[1] + ' <span class="nav-arrow">&#9654;</span></div>' +
        '<div class="nav-group-items">' + g[2].map(function (p) { return '<button class="nbtn" data-al="' + p[0] + '" onclick="nav(\'al_' + p[0] + '\',this)">' + p[1] + '</button>'; }).join('') + '</div>';
      anchor.parentNode.insertBefore(el, anchor);
      g[2].forEach(function (p) {
        var pn = document.createElement('div'); pn.id = 'p-al_' + p[0]; pn.className = 'panel al-panel';
        host.parentNode.appendChild(pn);
      });
    });
    return true;
  }
  /* DYOR's own STOCK 360 and Charts buttons now open AlphaLab's richer pages; the old ones stay as "classic" */
  function takeOver(oldKey, newKey, label) {
    var b = document.querySelector('[onclick^="nav(\'' + oldKey + '\'"]');
    var host = document.getElementById('p-emerging');
    if (!b || !host || document.getElementById('p-al_' + newKey)) return;
    var classic = b.cloneNode(true);
    classic.textContent = label + ' (classic)';
    classic.style.fontSize = '11px'; classic.style.opacity = '0.75';
    b.setAttribute('onclick', "nav('al_" + newKey + "',this)");
    b.setAttribute('data-al', newKey);
    b.parentNode.insertBefore(classic, b.nextSibling);
    var pn = document.createElement('div'); pn.id = 'p-al_' + newKey; pn.className = 'panel al-panel';
    host.parentNode.appendChild(pn);
  }
  function markLocks() {
    if (!access) return;
    document.querySelectorAll('[data-al]').forEach(function (b) {
      if (access[b.getAttribute('data-al')] === false && !b.querySelector('.sig-lock')) b.insertAdjacentHTML('beforeend', ' <span class="sig-lock">&#128274;</span>');
    });
  }
  function msg(panel, html) { panel.innerHTML = '<div class="al-msg">' + html + '</div>'; }
  function open(key) {
    var panel = document.getElementById('p-al_' + key); if (!panel) return;
    msg(panel, 'Opening AlphaLab…');
    fetch(API + 'open?page=' + encodeURIComponent(key), { credentials: 'include' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; });
    }).then(function (x) {
      if (x.r.ok && x.d.url) {
        panel.innerHTML = '<iframe class="al-frame" src="' + esc(x.d.url) + '" allow="clipboard-write" referrerpolicy="no-referrer"></iframe>';
        var fr = panel.querySelector('iframe'), loads = 0;
        /* first load is the sign-in hand-off page, the second the AlphaLab page itself */
        fr.addEventListener('load', function () {
          if (++loads < 2) return;
          signedIn = Date.now();
          if (pending[key]) { var s = pending[key]; delete pending[key]; fr.src = symUrl(key, s); }
        });
        return;
      }
      loaded[key] = false;
      if (x.d.locked) {
        msg(panel, '<div style="font-size:30px">&#128274;</div><p>' + esc(x.d.detail) + '</p>' + (x.d.kind === 'sig' ?
          '<button class="btn" style="padding:9px 20px;font-weight:700" onclick="window.__alReq(this)">Request access</button>' : ''));
        return;
      }
      msg(panel, 'Could not open this page: ' + esc(x.d.detail || ('HTTP ' + x.r.status)) + '<br><br><button class="btn btn-s" onclick="window.__alRetry(\'' + key + '\')">Try again</button>');
    }).catch(function () { loaded[key] = false; msg(panel, 'Could not reach DYOR. <button class="btn btn-s" onclick="window.__alRetry(\'' + key + '\')">Try again</button>'); });
  }
  function symUrl(key, sym) { return AL + SYM_PAGES[key] + '?embed=1&sym=' + encodeURIComponent(sym); }
  /* open an AlphaLab stock page in DYOR on one symbol: __alGo('stock360', 'TCS') or __alGo('charts', 'TCS') */
  window.__alGo = function (key, sym) {
    sym = String(sym || '').trim().toUpperCase().replace(/[^A-Z0-9&_-]/g, '');
    var btn = document.querySelector('[data-al="' + key + '"]');
    if (!SYM_PAGES[key] || !btn || !document.getElementById('p-al_' + key)) return false;
    var fr = document.querySelector('#p-al_' + key + ' iframe');
    if (sym && fr && signedIn && Date.now() - signedIn < 7 * 3600 * 1000) fr.src = symUrl(key, sym);
    else if (sym) { pending[key] = sym; if (fr && signedIn) { loaded[key] = false; } }
    window.nav('al_' + key, btn);
    return true;
  };
  window.open360 = function (sym) { return window.__alGo('stock360', sym); };
  function wrapOpenChart() {
    var orig = window.openChart;
    if (typeof orig !== 'function' || orig.__al) return;
    var w = function (sym) { if (!window.__alGo('charts', sym)) return orig.apply(this, arguments); };
    w.__al = true;
    window.openChart = w;
  }
  window.__alRetry = function (k) { loaded[k] = true; open(k); };
  window.__alReq = function (b) {
    b.disabled = true; b.textContent = 'Sending…';
    fetch('/dyor/api/signals-access/request', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); }).then(function (d) { b.textContent = d.allowed ? 'Access granted, reload the page' : 'Request sent for review'; })
      .catch(function () { b.disabled = false; b.textContent = 'Request access'; });
  };
  function wrapNav() {
    var orig = window.nav;
    if (typeof orig !== 'function' || orig.__al) return;
    var w = function (p) {
      var r = orig.apply(this, arguments);
      if (typeof p === 'string' && p.indexOf('al_') === 0) {
        var k = p.slice(3);
        if (!loaded[k]) { loaded[k] = true; open(k); }
      }
      return r;
    };
    w.__al = true;
    window.nav = w;
  }
  function start() {
    if (!install()) { setTimeout(start, 300); return; }
    takeOver('stock360', 'stock360', 'Stock 360');
    takeOver('charts', 'charts', 'Charts');
    wrapNav(); setTimeout(wrapNav, 1500);
    wrapOpenChart(); setTimeout(wrapOpenChart, 1500);
    fetch(API + 'access', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { access = d; markLocks(); }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
