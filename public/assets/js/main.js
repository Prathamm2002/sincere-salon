/**
 * ============================================================================
 *  main.js — application entry point
 * ============================================================================
 *  Vanilla ES module. No framework, no build step.
 *
 *  Structure
 *    01. Config & tiny helpers
 *    02. API client
 *    03. Toasts
 *    04. Preloader
 *    05. Navigation
 *    06. Scroll reveal, counters, parallax
 *    07. 3D tilt (CSS)
 *    08. Business info
 *    09. Services
 *    10. Booking flow
 *    11. Reviews
 *    12. Contact form
 *    13. Hero WebGL bootstrap
 *    14. Init
 *
 *  Graceful degradation is deliberate throughout: if the PHP API is not
 *  running, every section falls back to bundled sample data so the page is
 *  still fully browsable. Look for FALLBACK_* below.
 * ============================================================================
 */

/* ==========================================================================
   01. CONFIG & HELPERS
   ========================================================================== */

const API_BASE = '/api';

/** Is the OS asking us to keep motion to a minimum? */
const prefersReducedMotion =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Shorthand DOM queries.
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Format a number as Indian Rupees with no decimal noise. */
const inr = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** "95m" → "1h 35m" */
const humanDuration = (mins) => {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

/** Escape a string before injecting it into innerHTML. */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/** Trailing-edge debounce — used for resize handlers. */
const debounce = (fn, wait = 150) => {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), wait);
  };
};

/** ★★★★☆ for a 1–5 rating. */
const starString = (rating) => '★'.repeat(rating) + '☆'.repeat(5 - rating);


/* ==========================================================================
   02. API CLIENT
   --------------------------------------------------------------------------
   One place that knows how to talk to PHP. Every call resolves to the
   envelope { success, message, data, errors } or throws an ApiError, so
   callers never have to think about HTTP status codes.
   ========================================================================== */

class ApiError extends Error {
  constructor(message, errors = {}, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.errors = errors;
    this.status = status;
  }
}

const api = {
  async request(path, { method = 'GET', body = null } = {}) {
    const options = { method, headers: {} };

    if (body !== null) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(`${API_BASE}/${path}`, options);
    } catch {
      // Network-level failure: PHP not running, offline, DNS, CORS.
      throw new ApiError('OFFLINE');
    }

    // A PHP fatal error returns HTML, not JSON — catch that explicitly rather
    // than letting JSON.parse throw something opaque.
    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new ApiError('The server sent something unexpected.', {}, res.status);
    }

    if (!payload.success) {
      throw new ApiError(payload.message || 'Request failed.', payload.errors || {}, res.status);
    }

    return payload;
  },

  get:  (path)       => api.request(path),
  post: (path, body) => api.request(path, { method: 'POST', body }),
};

/**
 * Should this failure drop the UI into offline/demo mode?
 *
 * Two very different kinds of failure arrive as ApiError:
 *   • The server is unreachable or broken (no PHP, no MySQL, 500). Nothing the
 *     visitor did caused it and nothing they can do will fix it — so the page
 *     quietly falls back to local data rather than showing them a stack trace.
 *   • The request itself was rejected (422 validation, 409 slot taken). That
 *     IS actionable, so it must be surfaced verbatim.
 */
const isServerDown = (err) => err.message === 'OFFLINE' || err.status >= 500;


/* ==========================================================================
   03. TOASTS
   ========================================================================== */

const toast = (message, type = 'info', ms = 4500) => {
  const stack = $('#toastStack');
  if (!stack) return;

  const el = document.createElement('div');
  el.className = `toast-msg ${type}`;
  el.textContent = message;
  stack.appendChild(el);

  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
};


/* ==========================================================================
   04. PRELOADER
   ========================================================================== */

const hidePreloader = () => {
  const el = $('#preloader');
  if (!el) return;
  el.classList.add('done');
  document.body.classList.remove('is-locked');
  // Remove from the accessibility tree once the fade finishes.
  setTimeout(() => el.setAttribute('hidden', ''), 700);
};


/* ==========================================================================
   05. NAVIGATION
   ========================================================================== */

function initNav() {
  const nav = $('#siteNav');
  const toggle = $('#navToggle');
  const links = $('#navLinks');

  // -- Solid background once scrolled off the hero -------------------------
  // rAF-throttled: scroll fires far more often than the screen refreshes.
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      nav.classList.toggle('scrolled', window.scrollY > 60);
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // -- Mobile menu ---------------------------------------------------------
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    links.classList.toggle('open', !open);
  });

  // Close after tapping a link.
  links?.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      links.classList.remove('open');
      toggle?.setAttribute('aria-expanded', 'false');
    }
  });

  // -- Scroll spy ----------------------------------------------------------
  // Highlights the nav item for whichever section owns the middle of the
  // viewport. The rootMargin creates a thin band at ~45% height; a section
  // is "current" while it intersects that band.
  const sections = $$('main section[id]');
  const navMap = new Map(
    $$('#navLinks a').map((a) => [a.getAttribute('href').slice(1), a])
  );

  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = navMap.get(entry.target.id);
        if (!link) return;
        if (entry.isIntersecting) {
          navMap.forEach((a) => a.classList.remove('active'));
          link.classList.add('active');
        }
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  sections.forEach((s) => spy.observe(s));
}


/* ==========================================================================
   06. SCROLL REVEAL, COUNTERS, PARALLAX
   ========================================================================== */

/** Fade-and-rise elements marked [data-reveal] as they enter the viewport. */
function initReveal() {
  const items = $$('[data-reveal]');

  if (prefersReducedMotion) {
    items.forEach((el) => el.classList.add('in-view'));
    return;
  }

  const io = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in-view');
        obs.unobserve(entry.target);   // One-shot: never animate twice
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
  );

  items.forEach((el) => io.observe(el));
}

/** Roll numbers up from zero the first time a stat scrolls into view. */
function initCounters() {
  const nums = $$('[data-count]');
  if (!nums.length) return;

  const run = (el) => {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const suffix = el.dataset.suffix || '';
    const duration = 1600;
    const start = performance.now();

    const frame = (now) => {
      const p = Math.min((now - start) / duration, 1);
      // easeOutCubic — fast start, gentle landing.
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * eased).toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
  };

  if (prefersReducedMotion) {
    nums.forEach((el) => {
      el.textContent = el.dataset.count + (el.dataset.suffix || '');
    });
    return;
  }

  const io = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        run(entry.target);
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0.5 }
  );

  nums.forEach((el) => io.observe(el));
}

/**
 * Parallax band. Layers translate at a fraction of scroll distance.
 * Only transform is touched (never `top`), so the browser can keep this on
 * the compositor thread and off the layout path.
 */
function initParallax() {
  const layers = $$('.parallax-layer');
  if (!layers.length || prefersReducedMotion) return;

  let ticking = false;

  const update = () => {
    const vh = window.innerHeight;

    layers.forEach((layer) => {
      const band = layer.closest('.parallax-band');
      const rect = band.getBoundingClientRect();

      // Skip anything off-screen — no point computing invisible transforms.
      if (rect.bottom < 0 || rect.top > vh) return;

      // -1 (band entering from below) → 1 (band leaving at the top)
      const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
      const speed = parseFloat(layer.dataset.speed || '0.2');
      layer.style.setProperty('--shift', `${progress * speed * 220}px`);
    });

    ticking = false;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true }
  );

  update();
}


/* ==========================================================================
   07. 3D TILT (CSS)
   --------------------------------------------------------------------------
   Delegated from the document rather than bound per card, because cards are
   rendered asynchronously after the API responds. One listener covers every
   .tilt that will ever exist.
   ========================================================================== */

function initTilt() {
  if (prefersReducedMotion) return;
  // Pointer tilt is meaningless on touch and costs a repaint per move.
  if (window.matchMedia('(hover: none)').matches) return;

  // Kept deliberately small. A steeper tilt moves the card out from under the
  // pointer, so a click aimed at the corner can land outside the card.
  const MAX_DEG = 5;

  document.addEventListener(
    'pointermove',
    (e) => {
      const card = e.target.closest?.('.tilt');
      if (!card) return;

      const inner = $('.tilt-inner', card);
      if (!inner) return;

      const rect = card.getBoundingClientRect();
      // Cursor position within the card, normalised to -0.5…0.5
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;

      // Y rotation follows horizontal movement; X is inverted so the card
      // tips *away* from the cursor, which is what reads as physical.
      inner.style.setProperty('--ry', `${px * MAX_DEG * 2}deg`);
      inner.style.setProperty('--rx', `${-py * MAX_DEG * 2}deg`);

      // Glare hotspot follows the pointer.
      const glare = $('.tilt-glare', card);
      if (glare) {
        glare.style.setProperty('--mx', `${(px + 0.5) * 100}%`);
        glare.style.setProperty('--my', `${(py + 0.5) * 100}%`);
      }
    },
    { passive: true }
  );

  // Reset on exit so the card settles flat.
  document.addEventListener(
    'pointerout',
    (e) => {
      const card = e.target.closest?.('.tilt');
      if (!card || card.contains(e.relatedTarget)) return;

      const inner = $('.tilt-inner', card);
      inner?.style.setProperty('--rx', '0deg');
      inner?.style.setProperty('--ry', '0deg');
    },
    { passive: true }
  );
}


/* ==========================================================================
   08. BUSINESS INFO
   ========================================================================== */

// Mirrors lib/config.js. Used only when the API is unreachable.
const FALLBACK_INFO = {
  phone: '+919869075367',
  phoneUi: '+91 98690 75367',
  rating: 4.2,
  ratingCount: 412,
  isOpenNow: false,
  nextChange: 'Opens 9:00 AM',
  maxAdvanceDays: 60,
  today: null,          // Filled from the API; null means "use the local clock"
  hours: [
    { day: 'Mon', label: '9:00 AM – 9:30 PM', closed: false, isToday: false },
    { day: 'Tue', label: '9:00 AM – 9:30 PM', closed: false, isToday: false },
    { day: 'Wed', label: '9:00 AM – 9:30 PM', closed: false, isToday: false },
    { day: 'Thu', label: '9:00 AM – 9:30 PM', closed: false, isToday: false },
    { day: 'Fri', label: '9:00 AM – 9:30 PM', closed: false, isToday: false },
    { day: 'Sat', label: '8:00 AM – 10:00 PM', closed: false, isToday: false },
    { day: 'Sun', label: '8:00 AM – 10:00 PM', closed: false, isToday: false },
  ],
};

const state = {
  info: FALLBACK_INFO,
  services: [],       // Flat list, for id → service lookups
  cart: [],           // Selected service objects
  date: null,         // "YYYY-MM-DD"
  time: null,         // "HH:MM"
  step: 1,
  apiLive: false,     // Did the API answer? Drives fallback messaging.
};

async function loadInfo() {
  try {
    const { data } = await api.get('info');
    state.info = data;
    state.apiLive = true;
  } catch {
    state.info = FALLBACK_INFO;   // Keep the page usable
  }
  renderInfo();
}

function renderInfo() {
  const { isOpenNow, nextChange, hours, ratingCount } = state.info;

  // Status pill
  const pill = $('#statusPill');
  if (pill) {
    pill.classList.toggle('open', isOpenNow);
    pill.classList.toggle('closed', !isOpenNow);
    $('.txt', pill).textContent = isOpenNow ? `Open · ${nextChange}` : `Closed · ${nextChange}`;
  }

  // Hours table
  const tbody = $('#hoursTable tbody');
  if (tbody) {
    tbody.innerHTML = hours
      .map(
        (h) => `
        <tr class="${h.isToday ? 'today' : ''}">
          <td>${esc(h.day)}</td>
          <td>${esc(h.label)}</td>
        </tr>`
      )
      .join('');
  }

  // Footer line
  const footerHours = $('#footerHours');
  if (footerHours) {
    const today = hours.find((h) => h.isToday) || hours[0];
    footerHours.textContent = `${today.day} · ${today.label}`;
  }

  // Rating counts
  $$('#ratingCount, #reviewCount').forEach((el) => (el.textContent = ratingCount));
  $('#year').textContent = new Date().getFullYear();
}


/* ==========================================================================
   09. SERVICES
   ========================================================================== */

// Trimmed mirror of the schema.sql seed data, for offline browsing.
const FALLBACK_SERVICES = [
  {
    slug: 'hair', name: 'Hair', services: [
      { id: 1, name: 'Signature Haircut', description: 'Consultation, precision cut and finish styling.', price: 250, duration: 40, signature: true },
      { id: 2, name: 'Quick Trim', description: 'Neaten-up between cuts. In and out.', price: 150, duration: 20, signature: false },
      { id: 3, name: 'Kids Haircut', description: 'Patient, gentle cut for under-12s.', price: 180, duration: 30, signature: false },
      { id: 4, name: 'Hair Wash & Blow Dry', description: 'Deep cleanse with a salon-grade finish.', price: 200, duration: 25, signature: false },
      { id: 5, name: 'Hair Colour (Global)', description: 'Full-head ammonia-free colour.', price: 900, duration: 90, signature: false },
      { id: 6, name: 'Beard Colour', description: 'Natural-tone grey coverage for the beard.', price: 350, duration: 30, signature: false },
    ],
  },
  {
    slug: 'shave', name: 'Shave & Beard', services: [
      { id: 7, name: 'Royal Hot-Towel Shave', description: 'Steam towel, pre-shave oil, straight razor, cooling balm.', price: 350, duration: 35, signature: true },
      { id: 8, name: 'Classic Shave', description: 'Clean, close and quick.', price: 150, duration: 20, signature: false },
      { id: 9, name: 'Beard Sculpt & Trim', description: 'Line-up, shape and conditioning oil.', price: 200, duration: 25, signature: false },
      { id: 10, name: 'Moustache Trim', description: 'Precision detailing.', price: 80, duration: 10, signature: false },
    ],
  },
  {
    slug: 'massage', name: 'Massage & Therapy', services: [
      { id: 11, name: 'Head Massage (Oil)', description: 'The one regulars keep coming back for. Deep scalp relief.', price: 300, duration: 30, signature: true },
      { id: 12, name: 'Head, Neck & Shoulder', description: 'Extended pressure-point work down the shoulders.', price: 450, duration: 45, signature: false },
      { id: 13, name: 'Hair Spa Treatment', description: 'Steam, mask and massage for dry or damaged hair.', price: 800, duration: 60, signature: false },
      { id: 14, name: 'Anti-Dandruff Therapy', description: 'Medicated scalp treatment with steam.', price: 600, duration: 45, signature: false },
    ],
  },
  {
    slug: 'skin', name: 'Skin & Grooming', services: [
      { id: 15, name: 'Cleanup & De-Tan', description: 'Deep-pore cleanse and tan removal.', price: 500, duration: 40, signature: false },
      { id: 16, name: 'Fruit Facial', description: 'Brightening facial for tired city skin.', price: 700, duration: 50, signature: false },
      { id: 17, name: 'Charcoal Face Pack', description: 'Draws out pollution build-up.', price: 400, duration: 30, signature: false },
      { id: 18, name: 'Threading (Eyebrow)', description: 'Clean, defined brow shaping.', price: 60, duration: 10, signature: false },
    ],
  },
];

let categories = [];
let activeCategory = 'all';
let servicesFirstRender = true;   // Gates the one-time entrance animation

async function loadServices() {
  try {
    const { data } = await api.get('services');
    categories = data.categories;
  } catch (err) {
    categories = FALLBACK_SERVICES;
    if (isServerDown(err)) {
      toast('Showing the sample menu — the live price list is unavailable.', 'info', 6000);
    }
  }

  // Flatten once for O(1) lookups by id elsewhere.
  state.services = categories.flatMap((c) => c.services);

  renderCategoryTabs();
  renderServices();
}

function renderCategoryTabs() {
  const wrap = $('#catTabs');
  if (!wrap) return;

  const tabs = [{ slug: 'all', name: 'Everything' }, ...categories];

  wrap.innerHTML = tabs
    .map(
      (c) => `
      <button class="cat-tab ${c.slug === activeCategory ? 'active' : ''}"
              role="tab" aria-selected="${c.slug === activeCategory}"
              data-cat="${esc(c.slug)}">${esc(c.name)}</button>`
    )
    .join('');

  // Bind once. Replacing innerHTML does NOT remove listeners from the
  // container, so re-binding here would stack a new handler on every tab
  // click — two clicks in, each tab press fired the render twice.
  if (!wrap.dataset.bound) {
    wrap.dataset.bound = '1';
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-tab');
      if (!btn) return;
      activeCategory = btn.dataset.cat;
      renderCategoryTabs();
      renderServices();
    });
  }
}

function renderServices() {
  const grid = $('#serviceGrid');
  if (!grid) return;

  const visible =
    activeCategory === 'all'
      ? categories
      : categories.filter((c) => c.slug === activeCategory);

  const cards = visible.flatMap((cat) =>
    cat.services.map(
      (s, i) => `
      <div class="col-md-6 col-lg-4" data-reveal style="--i:${i % 3}">
        <article class="tilt h-100">
          <div class="tilt-inner glass service-card ${s.signature ? 'signature' : ''}
                      ${state.cart.some((c) => c.id === s.id) ? 'selected' : ''}"
               data-service="${s.id}" role="button" tabindex="0"
               aria-pressed="${state.cart.some((c) => c.id === s.id)}">
            <span class="tilt-glare" aria-hidden="true"></span>
            <div class="tilt-layer">
              <div class="service-head">
                <h3>${esc(s.name)}</h3>
                <span class="service-price">${inr(s.price)}</span>
              </div>
              <p>${esc(s.description)}</p>
              <div class="service-meta">
                <span>${s.signature ? '<span class="badge-signature">Signature</span> ' : ''}${humanDuration(s.duration)}</span>
                <span class="add-hint">${state.cart.some((c) => c.id === s.id) ? '✓ Added' : '+ Add'}</span>
              </div>
            </div>
          </div>
        </article>
      </div>`
    )
  );

  grid.innerHTML = cards.join('');

  if (servicesFirstRender) {
    // Observe the new cards so they fade in as they scroll into view.
    initReveal();
    servicesFirstRender = false;
  } else {
    // Category switch: reveal immediately. Replaying the entrance animation
    // would blank the grid every time the filter changes.
    $$('[data-reveal]', grid).forEach((el) => el.classList.add('in-view'));
  }
}

/**
 * Sync one card's selected state without touching the rest of the grid.
 *
 * Re-rendering the whole grid on selection was the original approach and it
 * was wrong three times over: it destroyed the node under the cursor (so the
 * card lost :hover), it re-ran the reveal animation on all 18 cards, and it
 * discarded and rebuilt DOM for a two-attribute change.
 */
function setCardSelected(cardEl, selected) {
  if (!cardEl) return;
  cardEl.classList.toggle('selected', selected);
  cardEl.setAttribute('aria-pressed', String(selected));
  const hint = $('.add-hint', cardEl);
  if (hint) hint.textContent = selected ? '✓ Added' : '+ Add';
}

/** Deselect every card — used when the cart is emptied. */
function clearAllCardSelections() {
  $$('#serviceGrid [data-service]').forEach((el) => setCardSelected(el, false));
}

/** Click or Enter/Space on a service card toggles it in the cart. */
function initServiceSelection() {
  const grid = $('#serviceGrid');
  if (!grid) return;

  const toggle = (el) => {
    const id = Number(el.dataset.service);
    const service = state.services.find((s) => s.id === id);
    if (!service) return;

    const idx = state.cart.findIndex((c) => c.id === id);
    let selected;

    if (idx > -1) {
      state.cart.splice(idx, 1);
      selected = false;
    } else {
      if (state.cart.length >= 6) {
        toast('That is plenty for one sitting — please book up to 6 services.', 'error');
        return;
      }
      state.cart.push(service);
      selected = true;
      toast(`${service.name} added.`, 'ok', 2200);
    }

    // Update this one card in place — see setCardSelected().
    setCardSelected(el, selected);
    renderCart();
  };

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-service]');
    if (card) toggle(card);
  });

  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-service]');
    if (!card) return;
    e.preventDefault();
    toggle(card);
  });
}


/* ==========================================================================
   10. BOOKING FLOW
   ========================================================================== */

const cartTotal = () => state.cart.reduce((sum, s) => sum + s.price, 0);
const cartDuration = () => state.cart.reduce((sum, s) => sum + s.duration, 0);

function renderCart() {
  const list = $('#cartList');
  const empty = $('#cartEmpty');
  if (!list) return;

  if (!state.cart.length) {
    list.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    list.innerHTML = state.cart
      .map(
        (s) => `
        <li class="cart-item">
          <span>
            <span class="nm">${esc(s.name)}</span>
            <span class="dur">${humanDuration(s.duration)}</span>
          </span>
          <span class="d-flex align-items-center gap-3">
            <span class="pr">${inr(s.price)}</span>
            <button class="cart-remove" data-remove="${s.id}"
                    aria-label="Remove ${esc(s.name)}">×</button>
          </span>
        </li>`
      )
      .join('');
  }

  $('#cartTotal').textContent = inr(cartTotal());
  $('#cartDuration').textContent = state.cart.length ? `about ${humanDuration(cartDuration())}` : '—';
  $('#toStep2').disabled = state.cart.length === 0;
}

/** Move the wizard to a step and sync the indicator. */
function goToStep(n) {
  state.step = n;

  $$('.step-pane').forEach((p) => p.classList.toggle('active', Number(p.dataset.pane) === n));

  $$('[data-step-dot]').forEach((dot) => {
    const i = Number(dot.dataset.stepDot);
    dot.classList.toggle('active', i === n);
    dot.classList.toggle('done', i < n);
  });

  $$('[data-step-line]').forEach((line) => {
    line.classList.toggle('filled', Number(line.dataset.stepLine) < n);
  });

  // Bring the panel into view without yanking the whole page.
  $('#book')?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}

/** Build the horizontal strip of selectable dates. */
function renderDateStrip() {
  const strip = $('#dateStrip');
  if (!strip) return;

  const days = 14;   // Two weeks is enough choice without overwhelming

  /*
   * Anchor the strip to the salon's own date, not the visitor's. The API
   * reports it as `today`; without that, someone browsing from a different
   * timezone is offered a "Today" the server already considers past, and
   * every slot lookup comes back "that date has already passed".
   * Appending T00:00:00 parses it as local midnight rather than UTC.
   */
  const today = state.info.today
    ? new Date(`${state.info.today}T00:00:00`)
    : new Date();

  const out = [];

  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    // Build the ISO string from local parts — toISOString() would shift by the
    // UTC offset and can land on the wrong day for IST (+05:30).
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    out.push(`
      <button class="date-chip ${iso === state.date ? 'active' : ''}" data-date="${iso}">
        <span class="dow">${i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
        <span class="dom">${d.getDate()}</span>
        <span class="mon">${d.toLocaleDateString('en-IN', { month: 'short' })}</span>
      </button>`);
  }

  strip.innerHTML = out.join('');
}

/** Fetch and paint the slot grid for the chosen date. */
async function renderSlots() {
  const grid = $('#slotGrid');
  if (!grid || !state.date) return;

  grid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1">Checking availability…</p>';

  let slots;
  try {
    const { data } = await api.get(
      `slots?date=${state.date}&duration=${cartDuration() || 30}`
    );
    if (!data.open) {
      grid.innerHTML = `<p style="color:var(--muted);grid-column:1/-1">${esc(data.note)}</p>`;
      return;
    }
    slots = data.slots;
  } catch (err) {
    if (!isServerDown(err)) {
      // A genuine rejection (bad date, too far ahead) — show what it said.
      grid.innerHTML = `<p style="color:var(--danger);grid-column:1/-1">${esc(err.message)}</p>`;
      return;
    }
    // Server unreachable or misconfigured: generate a plausible grid locally
    // so the visitor can still see and use the flow.
    slots = buildFallbackSlots(state.date);
  }

  // Late in the evening the remaining slots for today run out. Say so rather
  // than leaving an empty panel the visitor has to interpret.
  if (!slots.length) {
    grid.innerHTML =
      '<p style="color:var(--muted);grid-column:1/-1">' +
      'No slots left for this day — try tomorrow.</p>';
    return;
  }

  grid.innerHTML = slots
    .map(
      (s) => `
      <button class="slot ${s.time === state.time ? 'active' : ''}"
              data-time="${s.time}" ${s.available ? '' : 'disabled'}>
        ${esc(s.label)}
      </button>`
    )
    .join('');

  $('#toStep3').disabled = !state.time;
}

/** Client-side slot generation used only when the API is unreachable. */
function buildFallbackSlots(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const openHour = weekend ? 8 : 9;
  const closeHour = weekend ? 22 : 21.5;

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const slots = [];

  for (let h = openHour; h < closeHour; h += 0.5) {
    const hour = Math.floor(h);
    const min = h % 1 ? 30 : 0;
    if (isToday && (hour < now.getHours() || (hour === now.getHours() && min <= now.getMinutes()))) continue;

    const time = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    const label = new Date(2000, 0, 1, hour, min).toLocaleTimeString('en-IN', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    slots.push({ time, label, available: true });
  }

  return slots;
}

/** Paint the read-only summary shown on step 3. */
function renderBookSummary() {
  const box = $('#bookSummary');
  if (!box) return;

  const dateLabel = state.date
    ? new Date(`${state.date}T00:00:00`).toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short',
      })
    : '—';

  const timeLabel = state.time
    ? new Date(`2000-01-01T${state.time}:00`).toLocaleTimeString('en-IN', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : '—';

  box.innerHTML = `
    <div class="d-flex justify-content-between mb-1">
      <span style="color:var(--muted)">When</span>
      <b>${esc(dateLabel)} · ${esc(timeLabel)}</b>
    </div>
    <div class="d-flex justify-content-between mb-1">
      <span style="color:var(--muted)">Services</span>
      <b class="text-end">${state.cart.map((s) => esc(s.name)).join(', ')}</b>
    </div>
    <div class="d-flex justify-content-between">
      <span style="color:var(--muted)">Total</span>
      <b class="text-brass">${inr(cartTotal())} · ${humanDuration(cartDuration())}</b>
    </div>`;
}

/** Clear all validation error styling on a form. */
const clearFieldErrors = (form) => {
  $$('.field', form).forEach((f) => {
    f.classList.remove('invalid');
    const err = $('.err', f);
    if (err) err.textContent = '';
  });
};

/** Paint an { field: message } map onto a form. */
const paintFieldErrors = (form, errors) => {
  Object.entries(errors).forEach(([name, message]) => {
    const field = $(`[data-field="${name}"]`, form);
    if (!field) return;
    field.classList.add('invalid');
    const err = $('.err', field);
    if (err) err.textContent = message;
  });
};

/** Swap a submit button into a loading state; returns a restore function. */
function setLoading(btn, label = 'Working…') {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${label}`;
  return () => {
    btn.disabled = false;
    btn.innerHTML = original;
  };
}

function initBooking() {
  renderCart();
  renderDateStrip();

  // -- Remove from cart ----------------------------------------------------
  $('#cartList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const id = Number(btn.dataset.remove);
    state.cart = state.cart.filter((s) => s.id !== id);
    renderCart();
    setCardSelected($(`#serviceGrid [data-service="${id}"]`), false);
  });

  // -- Step navigation -----------------------------------------------------
  $('#toStep2')?.addEventListener('click', () => {
    // Default to today so the grid is never empty on arrival.
    if (!state.date) {
      const first = $('.date-chip');
      if (first) {
        state.date = first.dataset.date;
        renderDateStrip();
      }
    }
    goToStep(2);
    renderSlots();
  });

  $('#toStep3')?.addEventListener('click', () => {
    renderBookSummary();
    goToStep(3);
  });

  $$('[data-back]').forEach((btn) =>
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.back)))
  );

  // -- Date selection ------------------------------------------------------
  $('#dateStrip')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.date-chip');
    if (!chip) return;
    state.date = chip.dataset.date;
    state.time = null;                 // A new day invalidates the old time
    $('#toStep3').disabled = true;
    renderDateStrip();
    renderSlots();
  });

  // -- Slot selection ------------------------------------------------------
  $('#slotGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.slot');
    if (!btn || btn.disabled) return;
    state.time = btn.dataset.time;
    $$('.slot').forEach((s) => s.classList.toggle('active', s === btn));
    $('#toStep3').disabled = false;
  });

  // -- Submit --------------------------------------------------------------
  $('#bookingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    clearFieldErrors(form);

    const payload = {
      name: $('#bkName').value.trim(),
      phone: $('#bkPhone').value.trim(),
      email: $('#bkEmail').value.trim(),
      notes: $('#bkNotes').value.trim(),
      date: state.date,
      time: state.time,
      services: state.cart.map((s) => s.id),
    };

    // Client-side pre-check. The server repeats all of this — this pass only
    // exists to save the user a round-trip.
    const errors = {};
    if (payload.name.length < 2) errors.name = 'Please tell us your name.';
    if (!/^[6-9]\d{9}$/.test(payload.phone.replace(/\D/g, '').slice(-10))) {
      errors.phone = 'Enter a valid 10-digit Indian mobile number.';
    }
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      errors.email = 'That email address does not look right.';
    }

    if (Object.keys(errors).length) {
      paintFieldErrors(form, errors);
      return;
    }

    const restore = setLoading($('#submitBooking'), 'Booking…');

    try {
      const { data } = await api.post('book', payload);
      showConfirmation(data);
    } catch (err) {
      if (isServerDown(err)) {
        // Demo mode: fabricate a reference so the flow can be seen end to end.
        showConfirmation({
          reference: 'SMS-DEMO' + Math.floor(Math.random() * 90 + 10),
          name: payload.name,
          dateLabel: new Date(`${state.date}T00:00:00`).toLocaleDateString('en-IN', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
          }),
          timeLabel: new Date(`2000-01-01T${state.time}:00`).toLocaleTimeString('en-IN', {
            hour: 'numeric', minute: '2-digit', hour12: true,
          }),
          total: cartTotal(),
          duration: cartDuration(),
          services: state.cart.map((s) => s.name),
          demo: true,
        });
      } else {
        paintFieldErrors(form, err.errors);
        toast(err.message, 'error');
      }
    } finally {
      restore();
    }
  });

  // -- Start over ----------------------------------------------------------
  $('#bookAnother')?.addEventListener('click', () => {
    state.cart = [];
    state.date = null;
    state.time = null;
    renderCart();
    clearAllCardSelections();
    renderDateStrip();
    goToStep(1);
  });
}

function showConfirmation(booking) {
  $('#confirmRef').textContent = booking.reference;

  $('#confirmDetail').innerHTML = `
    ${esc(booking.dateLabel)} at ${esc(booking.timeLabel)}<br>
    ${booking.services.map(esc).join(' · ')}<br>
    <b class="text-brass">${inr(booking.total)}</b> · about ${humanDuration(booking.duration)}
    ${booking.demo ? '<br><small style="color:var(--danger)">Demo only — the PHP API is not running, so this was not saved.</small>' : ''}`;

  // Prefilled WhatsApp message so the customer can confirm in one tap.
  const message = encodeURIComponent(
    `Hi Sincere Men's Salon, I have booked ${booking.reference} — ` +
    `${booking.services.join(', ')} on ${booking.dateLabel} at ${booking.timeLabel}.`
  );
  $('#waConfirm').href = `https://wa.me/${state.info.phone.replace(/\D/g, '')}?text=${message}`;

  goToStep(4);
}


/* ==========================================================================
   11. REVIEWS
   ========================================================================== */

const FALLBACK_REVIEWS = [
  { id: 1, author: 'Google Reviewer', rating: 5, source: 'google', date: '2020-02-01',
    body: 'A great place to get a quick haircut, shave or head massage. The place was clean. Good service. Lot of waiting on Sunday morning. Good staff.' },
  { id: 2, author: 'Google Reviewer', rating: 4, source: 'google', date: '2018-06-01',
    body: 'Good value for money men\'s salon. Pretty neat and clean. Staff is trained and generally does a good job with your hair.' },
  { id: 3, author: 'Google Reviewer', rating: 4, source: 'google', date: '2021-11-01',
    body: 'Nice service and good staff. Reasonable rates for the area and they never rush you through the cut.' },
  { id: 4, author: 'Rahul M.', rating: 5, source: 'website', date: '2024-08-14',
    body: 'Been coming here for years for the head massage. Twenty minutes and a whole week of Mumbai traffic leaves your shoulders.' },
  { id: 5, author: 'Imran S.', rating: 4, source: 'website', date: '2025-01-22',
    body: 'Walk-in on a weekday is quick. Sundays you will wait, but they are honest about how long.' },
];

async function loadReviews() {
  let reviews;
  try {
    const { data } = await api.get('reviews?limit=6');
    reviews = data.reviews;
  } catch {
    reviews = FALLBACK_REVIEWS;
  }
  renderReviews(reviews);
}

function renderReviews(reviews) {
  const grid = $('#reviewGrid');
  if (!grid) return;

  grid.innerHTML = reviews
    .map((r, i) => {
      const when = r.date
        ? new Date(`${r.date}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
        : '';
      const via = r.source === 'google' ? 'via Google' : 'via this site';

      return `
      <div class="col-md-6 col-lg-4" data-reveal style="--i:${i % 3}">
        <div class="flip" tabindex="0" role="button"
             aria-label="Review by ${esc(r.author)}. Activate to read in full.">
          <div class="flip-inner">
            <div class="flip-face glass">
              <span class="stars" aria-label="${r.rating} out of 5">${starString(r.rating)}</span>
              <p class="review-quote mt-2">${esc(r.body)}</p>
              <div class="review-author">
                ${esc(r.author)}
                <small>${esc(when)} · ${via}</small>
              </div>
              <span class="flip-hint" aria-hidden="true">Read →</span>
            </div>
            <div class="flip-face flip-back glass">
              <p class="review-quote">${esc(r.body)}</p>
              <div class="review-author">${esc(r.author)}<small>${esc(when)}</small></div>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join('');

  // Touch devices have no hover — tap or keyboard toggles the flip instead.
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.flip');
    if (card && window.matchMedia('(hover: none)').matches) {
      card.classList.toggle('flipped');
    }
  });

  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.flip');
    if (!card) return;
    e.preventDefault();
    card.classList.toggle('flipped');
  });

  initReveal();
}

function initReviewForm() {
  const form = $('#reviewForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);

    const payload = {
      author: $('#rvName').value.trim(),
      rating: Number($('#rvRating').value),
      body: $('#rvBody').value.trim(),
    };

    const btn = $('button[type="submit"]', form);
    const restore = setLoading(btn, 'Sending…');

    try {
      const res = await api.post('reviews', payload);
      toast(res.message, 'ok', 6000);
      form.reset();
      bootstrap.Modal.getInstance($('#reviewModal'))?.hide();
    } catch (err) {
      if (isServerDown(err)) {
        toast('Cannot reach the server right now — please call us instead.', 'error');
      } else {
        paintFieldErrors(form, err.errors);
        toast(err.message, 'error');
      }
    } finally {
      restore();
    }
  });
}


/* ==========================================================================
   12. CONTACT FORM
   ========================================================================== */

function initContactForm() {
  const form = $('#contactForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(form);

    const payload = {
      name: $('#ctName').value.trim(),
      phone: $('#ctPhone').value.trim(),
      message: $('#ctMessage').value.trim(),
      website: $('#ctWebsite').value,   // Honeypot — must stay empty
    };

    const btn = $('button[type="submit"]', form);
    const restore = setLoading(btn, 'Sending…');

    try {
      const res = await api.post('contact', payload);
      toast(res.message, 'ok', 6000);
      form.reset();
    } catch (err) {
      if (isServerDown(err)) {
        // No server: hand off to WhatsApp so the enquiry still reaches them.
        const text = encodeURIComponent(`Hi, I'm ${payload.name}. ${payload.message}`);
        window.open(`https://wa.me/${state.info.phone.replace(/\D/g, '')}?text=${text}`, '_blank');
        toast('Opening WhatsApp instead — the server is not running.', 'info', 6000);
      } else {
        paintFieldErrors(form, err.errors);
        toast(err.message, 'error');
      }
    } finally {
      restore();
    }
  });
}


/* ==========================================================================
   13. HERO WebGL BOOTSTRAP
   --------------------------------------------------------------------------
   Three.js (~600 KB) is imported dynamically and only where it will actually
   be enjoyed. Everything below the guard clauses is a progressive enhancement
   over a hero that already looks complete without it.
   ========================================================================== */

async function initHero3D() {
  const canvas = $('#hero-canvas');
  if (!canvas) return;

  // Skip on: reduced motion, low core count (proxy for a weak device),
  // or a data-saver connection.
  const lowPower =
    (navigator.hardwareConcurrency || 8) <= 2 ||
    navigator.connection?.saveData === true;

  if (prefersReducedMotion || lowPower) {
    canvas.remove();     // The CSS gradient hero stands on its own
    return;
  }

  try {
    const { HeroScene, supportsWebGL } = await import('./scene3d.js');

    if (!supportsWebGL()) {
      canvas.remove();
      return;
    }

    const scene = new HeroScene(canvas);
    scene.start();

    // Expose for debugging from the console; harmless in production.
    window.__heroScene = scene;
  } catch (err) {
    // A CDN blocked by a corporate proxy should degrade, not break the page.
    console.warn('[hero] 3D scene unavailable:', err);
    canvas.remove();
  }
}


/* ==========================================================================
   14. INIT
   ========================================================================== */

function init() {
  document.body.classList.add('is-locked');   // Hold scroll behind the preloader

  // Synchronous UI first — these do not wait on the network.
  initNav();
  initReveal();
  initCounters();
  initParallax();
  initTilt();
  initServiceSelection();
  initBooking();
  initReviewForm();
  initContactForm();

  // Network-dependent sections load in parallel, each with its own fallback.
  Promise.allSettled([loadInfo(), loadServices(), loadReviews()]).then(() => {
    renderCart();
    // Rebuild the date strip now that the salon's real date is known — the
    // first pass in initBooking() could only use the visitor's clock.
    renderDateStrip();
  });

  // Start the WebGL scene alongside, not after.
  initHero3D();

  // Reveal the page once fonts and images have settled, with a hard timeout
  // so a slow CDN can never leave the visitor staring at the preloader.
  const reveal = () => hidePreloader();
  if (document.readyState === 'complete') {
    setTimeout(reveal, 400);
  } else {
    window.addEventListener('load', () => setTimeout(reveal, 400), { once: true });
  }
  setTimeout(reveal, 4000);

  // Recompute parallax offsets after a viewport change.
  window.addEventListener('resize', debounce(() => initParallax(), 200));
}

// The script is a module, so it is deferred — the DOM is already parsed.
init();
