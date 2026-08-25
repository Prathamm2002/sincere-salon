/**
 * ============================================================================
 *  admin.js — dashboard client
 * ============================================================================
 *  Talks to /api/admin. The session is an HttpOnly cookie, so this script
 *  never sees or stores a token; it simply discovers on load whether the
 *  cookie it already carries is still valid, by asking for the data.
 * ============================================================================
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function toast(message, type = 'info', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = message;
  $('#toastStack').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

/**
 * Every state-changing call carries X-Requested-With. A cross-site HTML form
 * cannot set a custom header without a CORS preflight, which the API refuses —
 * so this is a second CSRF barrier behind the SameSite=Strict cookie.
 */
async function api(path, { method = 'GET', body = null } = {}) {
  const options = {
    method,
    headers: { 'X-Requested-With': 'salon-admin' },
    credentials: 'same-origin',
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(path, options);
  const payload = await res.json().catch(() => ({ success: false, message: 'Bad response.' }));

  if (!payload.success) {
    const err = new Error(payload.message || 'Request failed.');
    err.status = res.status;
    throw err;
  }
  return payload;
}

let state = { tab: 'bookings', data: null };

/* ==========================================================================
   Auth
   ========================================================================== */

function showLogin(message) {
  $('#loginView').classList.remove('hidden');
  $('#dashView').classList.add('hidden');
  const box = $('#loginError');
  if (message) { box.textContent = message; box.classList.remove('hidden'); }
  else box.classList.add('hidden');
}

function showDash() {
  $('#loginView').classList.add('hidden');
  $('#dashView').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('button', e.target);
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: { username: $('#u').value.trim(), password: $('#p').value },
    });
    $('#p').value = '';
    showDash();
    await load();
  } catch (err) {
    showLogin(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('#signOut').addEventListener('click', async () => {
  await api('/api/admin/login', { method: 'DELETE' }).catch(() => {});
  location.reload();
});

/* ==========================================================================
   Data
   ========================================================================== */

async function load() {
  try {
    const { data } = await api('/api/admin');
    state.data = data;
    renderTiles();
    renderPanel();
  } catch (err) {
    // 401 simply means the cookie is missing or expired — show the form, not
    // an error, since that is the normal first-visit path.
    if (err.status === 401) showLogin('');
    else toast(err.message, 'error', 6000);
  }
}

function renderTiles() {
  const s = state.data.stats;
  $('#tiles').innerHTML = [
    ['Today\'s Bookings', s.today],
    ['Awaiting Confirm', s.pending],
    ['30-Day Revenue', inr(s.revenue)],
    ['Reviews to Check', s.to_review],
    ['Unread Messages', s.unread],
  ].map(([label, value]) =>
    `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');

  $$('.tab').forEach((t) => {
    const extra = t.dataset.tab === 'reviews' ? s.to_review
                : t.dataset.tab === 'messages' ? s.unread : 0;
    const base = t.dataset.tab[0].toUpperCase() + t.dataset.tab.slice(1);
    t.textContent = extra ? `${base} (${extra})` : base;
  });
}

const statusColour = (s) => ({
  confirmed: 'var(--success)', completed: 'var(--brass-400)', cancelled: 'var(--danger)',
}[s] || 'var(--muted)');

function renderPanel() {
  const panel = $('#panel');
  const { bookings, reviews, messages } = state.data;

  if (state.tab === 'bookings') {
    if (!bookings.length) return void (panel.innerHTML = empty('No bookings yet.'));
    panel.innerHTML = `<table><thead><tr>
        <th>Ref</th><th>When</th><th>Customer</th><th>Services</th>
        <th>Total</th><th>Status</th></tr></thead><tbody>${
      bookings.map((b) => `<tr>
        <td><code style="color:var(--brass-400)">${esc(b.reference)}</code></td>
        <td>${esc(dateLabel(b.booking_date))}<br>
            <span style="color:var(--muted)">${esc(time12(b.booking_time))}</span></td>
        <td>${esc(b.customer_name)}<br>
            <a href="tel:+91${esc(b.phone)}" style="font-size:.8rem">${esc(b.phone)}</a></td>
        <td style="max-width:230px;color:var(--muted)">${esc(b.services || '—')}</td>
        <td>${inr(b.total_amount)}</td>
        <td><select class="mini" data-booking="${b.id}" aria-label="Status for ${esc(b.reference)}"
                    style="color:${statusColour(b.status)}">${
          ['pending', 'confirmed', 'completed', 'cancelled'].map((s) =>
            `<option value="${s}"${b.status === s ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`
          ).join('')}</select></td>
      </tr>`).join('')}</tbody></table>`;
  }

  if (state.tab === 'reviews') {
    if (!reviews.length) return void (panel.innerHTML = empty('No reviews yet.'));
    panel.innerHTML = `<table><thead><tr>
        <th>Author</th><th>Rating</th><th>Review</th><th>State</th><th>Action</th>
      </tr></thead><tbody>${
      reviews.map((r) => `<tr class="${r.is_approved ? '' : 'flag'}">
        <td>${esc(r.author_name)}<br>
            <span style="color:var(--muted);font-size:.78rem">${esc(r.source)}</span></td>
        <td style="color:var(--brass-400);white-space:nowrap">${stars(r.rating)}</td>
        <td style="max-width:380px;color:var(--muted)">${esc(r.body)}</td>
        <td style="white-space:nowrap">
          <span class="chip" style="color:${r.is_approved ? 'var(--success)' : 'var(--brass-400)'}">
            ${r.is_approved ? 'Live' : 'Pending'}</span>
          ${r.is_featured ? '<br><span class="chip" style="color:var(--brass-400);margin-top:.3rem">Featured</span>' : ''}
        </td>
        <td><div class="row-actions">
          ${r.is_approved ? '' : `<button class="mini" data-act="review_approve" data-id="${r.id}">Approve</button>`}
          <button class="mini" data-act="review_feature" data-id="${r.id}">${r.is_featured ? 'Unfeature' : 'Feature'}</button>
          <button class="mini danger" data-act="review_delete" data-id="${r.id}" data-confirm="Delete this review permanently?">Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table>`;
  }

  if (state.tab === 'messages') {
    if (!messages.length) return void (panel.innerHTML = empty('No messages yet.'));
    panel.innerHTML = `<table><thead><tr>
        <th>From</th><th>Message</th><th>Received</th><th>Action</th>
      </tr></thead><tbody>${
      messages.map((m) => `<tr class="${m.is_read ? '' : 'flag'}">
        <td>${esc(m.name)}<br>
            <a href="tel:+91${esc(m.phone)}" style="font-size:.8rem">${esc(m.phone)}</a></td>
        <td style="max-width:420px;color:var(--muted)">${esc(m.message)}</td>
        <td style="white-space:nowrap;color:var(--muted);font-size:.8rem">${esc(m.received)}</td>
        <td>${m.is_read
          ? '<span class="chip" style="color:var(--success)">Read</span>'
          : `<button class="mini" data-act="message_read" data-id="${m.id}">Mark Read</button>`}</td>
      </tr>`).join('')}</tbody></table>`;
  }
}

const empty = (msg) =>
  `<p style="text-align:center;padding:3rem 1rem;margin:0;color:var(--muted)">${esc(msg)}</p>`;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/** 'YYYY-MM-DD' -> 'Mon, 17 Aug'. Parsed as UTC so it cannot shift a day. */
function dateLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 'HH:MM' -> '6:00 PM' */
function time12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/* ==========================================================================
   Interactions — delegated, so re-rendered tables need no re-binding
   ========================================================================== */

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  state.tab = tab.dataset.tab;
  $$('.tab').forEach((t) => t.classList.toggle('on', t === tab));
  renderPanel();
}));

$('#panel').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;

  try {
    const res = await api('/api/admin', {
      method: 'POST',
      body: { action: btn.dataset.act, id: Number(btn.dataset.id) },
    });
    toast(res.message, 'ok');
    await load();
  } catch (err) {
    if (err.status === 401) showLogin('Your session expired. Please sign in again.');
    else toast(err.message, 'error');
  }
});

$('#panel').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-booking]');
  if (!sel) return;

  try {
    const res = await api('/api/admin', {
      method: 'POST',
      body: { action: 'booking_status', id: Number(sel.dataset.booking), status: sel.value },
    });
    toast(res.message, 'ok');
    await load();
  } catch (err) {
    if (err.status === 401) showLogin('Your session expired. Please sign in again.');
    else toast(err.message, 'error');
  }
});

// On load, try for data. Success means the cookie is still good and we can go
// straight to the dashboard; a 401 falls through to the login form.
(async function boot() {
  try {
    const { data } = await api('/api/admin');
    state.data = data;
    showDash();
    renderTiles();
    renderPanel();
  } catch {
    showLogin('');
  }
})();
