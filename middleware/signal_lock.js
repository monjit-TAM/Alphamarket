/* DYOR: advisor-only signals. Loaded by /var/www/dyor.html from /dyor/api/signals-access/lock.js.
   The backend refuses these features to anyone not allowed; this script only shows a lock
   and the request button instead of an empty panel, and adds the review list for admins. */
(function () {
  var LOCKED = { alphaoptions: 'Options Alpha', alphabot: 'AlphaBot', emerging: 'Emerging Leaders', alphaideas: 'Alpha Ideas', rmodels: 'Models' };
  var API = '/dyor/api/signals-access/';
  var st = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function call(path, body) {
    return fetch(API + path, body ? { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
                                  : { credentials: 'include' }).then(function (r) { return r.json(); });
  }

  function markMenu() {
    Object.keys(LOCKED).forEach(function (key) {
      document.querySelectorAll('[onclick^="nav(\'' + key + '\'"]').forEach(function (b) {
        if (!b.querySelector('.sig-lock')) b.insertAdjacentHTML('beforeend', ' <span class="sig-lock" title="For registered advisors">&#128274;</span>');
      });
    });
  }

  window.__sigMarkMenu = function () { if (st && st.logged_in && !st.allowed) markMenu(); };

  function card(key) {
    var r = st && st.request, name = LOCKED[key];
    var h = '<div class="sig-lock-card" style="max-width:560px;margin:60px auto;padding:28px;border:1px solid var(--border,#e2e8f0);border-radius:10px;background:var(--bg1,#fff);text-align:center">' +
      '<div style="font-size:34px">&#128274;</div>' +
      '<h2 style="margin:10px 0 8px">' + esc(name) + ' is for registered advisors</h2>' +
      '<p style="font-size:13px;color:var(--text2,#475569);line-height:1.6;margin:0 0 18px">' +
      'Signals in DYOR are open to SEBI-registered advisors on AlphaMarket. If you would like access, send a request and our team will review it.</p>';
    if (r && r.status === 'pending') {
      h += '<div style="font-size:13px;color:#b45309;font-weight:600">Your request is pending review (sent ' + esc(r.requested_at) + ').</div>';
    } else {
      if (r && r.status === 'rejected') h += '<div style="font-size:12px;color:var(--text3,#64748b);margin-bottom:10px">Your earlier request was not approved. You can ask again.</div>';
      h += '<button class="btn" onclick="window.__sigRequest(this)" style="padding:10px 22px;font-weight:700;border-radius:6px;cursor:pointer">Request access</button>';
    }
    return h + '</div>';
  }

  function showLocked(key, btn) {
    document.querySelectorAll('.panel').forEach(function (x) { x.classList.remove('on'); });
    document.querySelectorAll('.nbtn').forEach(function (x) { x.classList.remove('on'); });
    var el = document.getElementById('p-' + key);
    if (!el) return;
    el.classList.add('on');
    if (btn) btn.classList.add('on');
    Array.prototype.forEach.call(el.children, function (c) { if (!c.classList.contains('sig-lock-card')) c.style.display = 'none'; });
    var old = el.querySelector('.sig-lock-card');
    if (old) old.remove();
    el.insertAdjacentHTML('afterbegin', card(key));
  }

  window.__sigRequest = function (b) {
    b.disabled = true; b.textContent = 'Sending...';
    call('request', {}).then(function (d) {
      if (d.allowed) { location.reload(); return; }
      st.request = d.request;
      document.querySelectorAll('.panel.on').forEach(function (el) { var k = el.id.replace('p-', ''); if (LOCKED[k]) showLocked(k, null); });
    }).catch(function () { b.disabled = false; b.textContent = 'Request access'; alert('Could not send the request. Please try again.'); });
  };

  // ── admin: requests to review and current grants, at the top of the Admin page ──
  function renderAdmin() {
    var host = document.getElementById('p-admin');
    if (!host) return;
    var box = document.getElementById('sig-admin');
    if (!box) { host.insertAdjacentHTML('afterbegin', '<div id="sig-admin" style="margin-bottom:24px"></div>'); box = document.getElementById('sig-admin'); }
    box.innerHTML = '<div style="font-size:12px;color:var(--text3)">Loading signal access requests...</div>';
    call('admin/list').then(function (d) {
      var reqs = d.requests || [], grants = d.grants || [], pending = reqs.filter(function (r) { return r.status === 'pending'; });
      var td = 'style="padding:6px 8px;border-bottom:1px solid var(--border,#e2e8f0);font-size:12px"';
      var h = '<h3 style="margin:0 0 10px">Signal access requests (' + pending.length + ' pending)</h3>';
      if (!reqs.length) h += '<div style="font-size:12px;color:var(--text3)">No requests yet.</div>';
      else {
        h += '<table style="width:100%;border-collapse:collapse;margin-bottom:18px"><tr><th ' + td + '>Requested</th><th ' + td + '>User</th><th ' + td + '>Role</th><th ' + td + '>Status</th><th ' + td + '></th></tr>';
        reqs.slice(0, 50).forEach(function (r) {
          h += '<tr><td ' + td + '>' + esc(r.requested_at) + '</td><td ' + td + '>' + esc(r.email || r.username) + '</td><td ' + td + '>' + esc(r.role) + '</td><td ' + td + '>' + esc(r.status) +
            (r.decided_at ? ' <span style="color:var(--text3)">' + esc(r.decided_at) + '</span>' : '') + '</td><td ' + td + '>' +
            (r.status === 'pending' ? '<button class="btn btn-s" onclick="window.__sigDecide(' + r.id + ',\'approve\')">Approve</button> <button class="btn btn-s" onclick="window.__sigDecide(' + r.id + ',\'reject\')">Reject</button>' : '') + '</td></tr>';
        });
        h += '</table>';
      }
      h += '<h3 style="margin:0 0 10px">Investors with signal access (' + grants.length + ')</h3>';
      if (grants.length) {
        h += '<table style="width:100%;border-collapse:collapse"><tr><th ' + td + '>User</th><th ' + td + '>Since</th><th ' + td + '></th></tr>';
        grants.forEach(function (g) {
          h += '<tr><td ' + td + '>' + esc(g.email || g.username) + '</td><td ' + td + '>' + esc(g.created_at) + '</td><td ' + td + '><button class="btn btn-s" onclick="window.__sigRevoke(\'' + esc(g.user_id) + '\')">Revoke</button></td></tr>';
        });
        h += '</table>';
      } else h += '<div style="font-size:12px;color:var(--text3)">None. Advisors and admins have access without a grant.</div>';
      box.innerHTML = h;
    }).catch(function () { box.innerHTML = '<div style="font-size:12px;color:#ef4444">Could not load signal access requests.</div>'; });
  }
  window.__sigDecide = function (id, action) {
    if (!confirm((action === 'approve' ? 'Approve' : 'Reject') + ' this request?')) return;
    call('admin/decide', { id: id, action: action }).then(renderAdmin);
  };
  window.__sigRevoke = function (uid) {
    if (!confirm('Revoke this user\'s signal access?')) return;
    call('admin/revoke', { user_id: uid }).then(renderAdmin);
  };

  function wrapNav() {
    var orig = window.nav;
    if (typeof orig !== 'function' || orig.__sig) return;
    var wrapped = function (p, btn) {
      if (st && st.logged_in && !st.allowed && LOCKED[p]) return showLocked(p, btn);
      var r = orig.apply(this, arguments);
      if (p === 'admin' && st && st.is_admin) renderAdmin();
      return r;
    };
    wrapped.__sig = true;
    window.nav = wrapped;
  }

  function start() {
    call('status').then(function (d) {
      st = d;
      wrapNav();
      if (d.logged_in && !d.allowed) {
        markMenu();
        var on = document.querySelector('.panel.on');
        if (on && LOCKED[on.id.replace('p-', '')]) showLocked(on.id.replace('p-', ''), null);
      }
    }).catch(function () { /* the backend still enforces the lock */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
