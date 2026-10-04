/* AA-VTC — Administration. Vanilla ES module, no build step. */

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

const STATUS = {
  nouveau: 'Nouveau', confirme: 'Confirmé', termine: 'Terminé', annule: 'Annulé',
};
const SERVICE = {
  transfert: 'Transfert', mise_a_disposition: 'Mise à disposition', circuit: 'Circuit',
};

const $ = (id) => document.getElementById(id);
const money = (v) => (v === null || v === undefined || v === '' ? '—' : eur.format(Number(v)));
const asDate = (v) => (v ? new Date(v) : null);

/** Tiny DOM builder: el('div', { class: 'x' }, [child, 'text']) */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const state = {
  email: null,
  bookings: [],
  clients: [],
  devis: [],
  stats: null,
  weekStart: startOfWeek(new Date()),
};

/* ---------- API ---------- */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error, status: res.status });
  return data;
}

/* ---------- Toast ---------- */
let toastTimer = 0;
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-shown'), 3200);
}

/* ---------- Modal ---------- */
function openModal({ title, content, actions }) {
  const root = $('modal-root');
  const previous = document.activeElement;

  const box = el('div', { class: 'modal__box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('div', { class: 'modal__head' }, [
      el('h2', { class: 'modal__title' }, title),
      el('button', { class: 'modal__close', type: 'button', 'aria-label': 'Fermer', onclick: close }, '×'),
    ]),
    content,
    el('div', { class: 'modal__actions' }, actions),
  ]);
  const modal = el('div', { class: 'modal' }, [
    el('button', { class: 'modal__backdrop', type: 'button', tabindex: '-1', 'aria-hidden': 'true', onclick: close }),
    box,
  ]);

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusables = box.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function close() {
    document.removeEventListener('keydown', onKey, true);
    modal.remove();
    previous?.focus?.();
  }

  root.replaceChildren(modal);
  document.addEventListener('keydown', onKey, true);
  (box.querySelector('input, select, textarea') || box.querySelector('button'))?.focus();
  return { close, box };
}

function field(label, input, { full = false } = {}) {
  return el('div', { class: full ? 'full' : '' }, [el('label', { for: input.id }, label), input]);
}
const input = (id, props = {}) => el('input', { id, ...props });
const select = (id, options, value) =>
  el('select', { id }, Object.entries(options).map(([v, label]) => el('option', { value: v, selected: v === value }, label)));

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ---------- Auth ---------- */
function showLogin() {
  $('app').hidden = true;
  $('login-view').hidden = false;
  $('login-email').focus();
}

async function boot() {
  try {
    const session = await api('/api/admin/auth');
    if (!session.signedIn) return showLogin();
    state.email = session.email;
    $('session-email').textContent = session.email;
    $('login-view').hidden = true;
    $('app').hidden = false;
    await refreshAll();
  } catch {
    showLogin();
  }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('login-submit');
  const error = $('login-error');
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Connexion…';
  try {
    await api('/api/admin/auth', {
      method: 'POST',
      body: { email: $('login-email').value.trim(), password: $('login-password').value },
    });
    $('login-password').value = '';
    error.hidden = true;
    error.textContent = '';
    await boot();
  } catch (err) {
    error.textContent = err.code === 'rate_limited'
      ? 'Trop de tentatives. Réessayez dans quelques minutes.'
      : err.code === 'not_configured'
        ? 'Administration non configurée (variables ADMIN_EMAIL / ADMIN_PASSWORD_HASH manquantes).'
        : 'E-mail ou mot de passe incorrect.';
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Se connecter';
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/admin/auth', { method: 'DELETE' }).catch(() => {});
  location.reload();
});

/* ---------- Tabs ---------- */
const TABS = ['dashboard', 'bookings', 'planning', 'clients', 'devis'];
function showTab(name) {
  TABS.forEach((tab) => {
    const button = $(`tab-${tab}`);
    const view = $(`view-${tab}`);
    const active = tab === name;
    button.setAttribute('aria-selected', String(active));
    view.hidden = !active;
  });
  $(`view-${name}`).focus();
}
TABS.forEach((tab) => $(`tab-${tab}`).addEventListener('click', () => showTab(tab)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
document.querySelectorAll('[data-new-booking]').forEach((b) => b.addEventListener('click', () => bookingModal(null)));

/* ---------- Data ---------- */
async function refreshAll() {
  await Promise.all([loadBookings(), loadStats(), loadClients(), loadDevis()]);
}

async function loadBookings() {
  const params = new URLSearchParams();
  const status = $('filter-status').value;
  const from = $('filter-from').value;
  const to = $('filter-to').value;
  const q = $('filter-q').value.trim();
  if (status) params.set('status', status);
  if (from) params.set('from', new Date(`${from}T00:00`).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59`).toISOString());
  if (q) params.set('q', q);
  const { bookings } = await api(`/api/admin/bookings?${params}`);
  state.bookings = bookings;
  renderBookings();
  renderRecent();
  renderPlanning();
}

async function loadStats() {
  state.stats = await api('/api/admin/stats');
  renderStats();
}

async function loadClients() {
  const q = $('clients-q').value.trim();
  const { clients } = await api(`/api/admin/clients?${new URLSearchParams(q ? { q } : {})}`);
  state.clients = clients;
  renderClients();
}

async function loadDevis() {
  const { devis } = await api('/api/admin/devis');
  state.devis = devis;
  renderDevis();
}

let filterTimer = 0;
['filter-status', 'filter-from', 'filter-to', 'filter-q'].forEach((id) =>
  $(id).addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => loadBookings().catch(() => {}), 250);
  })
);
$('clients-q').addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => loadClients().catch(() => {}), 250);
});

/* ---------- Dashboard ---------- */
function renderStats() {
  const s = state.stats;
  if (!s) return;
  const month = s.byMonth[s.byMonth.length - 1];
  const tiles = [
    { label: 'Courses à venir', value: s.upcoming, hint: 'Nouvelles ou confirmées' },
    { label: 'CA HT ce mois', value: money(month?.revenue_ht || 0), gold: true, hint: `${month?.bookings || 0} course(s)` },
    { label: 'Réservations', value: s.totals.bookings, hint: `${s.byStatus.nouveau || 0} nouvelle(s)` },
    { label: 'Clients', value: s.clients.total, hint: `${s.clients.repeat_clients} fidèle(s)` },
  ];
  $('stat-tiles').replaceChildren(...tiles.map((t) =>
    el('li', { class: 'stat' }, [
      el('p', { class: 'stat__label' }, t.label),
      el('p', { class: `stat__value${t.gold ? ' stat__value--gold' : ''}` }, t.value),
      el('p', { class: 'stat__hint' }, t.hint),
    ])
  ));
  renderRevenue();
  renderRoutes();
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
}

function renderRevenue() {
  const data = state.stats.byMonth;
  const chart = $('revenue-chart');
  if (!data.length) {
    chart.replaceChildren(el('p', { class: 'empty' }, 'Aucune donnée pour le moment.'));
    return;
  }
  $('revenue-table').replaceChildren(
    el('div', { class: 'table-wrap' }, el('table', { class: 'data', style: 'min-width:0' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Mois'), el('th', { class: 'num' }, 'Courses'), el('th', { class: 'num' }, 'CA HT')])),
      el('tbody', {}, data.map((d) => el('tr', {}, [
        el('td', {}, d.month),
        el('td', { class: 'num' }, d.bookings),
        el('td', { class: 'num' }, money(d.revenue_ht)),
      ]))),
    ]))
  );

  if (data.length < 2) {
    // One bar is not a chart — show the figure itself (and the table below still lists it).
    const only = data[0];
    chart.replaceChildren(
      el('p', { class: 'stat__value stat__value--gold', style: 'font-size:2.4rem' }, money(only.revenue_ht)),
      el('p', { class: 'stat__hint' }, `${monthLabel(only.month)} · ${only.bookings} course(s) · l'historique mensuel apparaîtra dès le mois prochain`),
    );
    return;
  }
  const max = Math.max(...data.map((d) => d.revenue_ht), 1);
  chart.replaceChildren(
    el('div', { class: 'bars', role: 'img', 'aria-label': `Chiffre d'affaires HT par mois : ${data.map((d) => `${monthLabel(d.month)} ${Math.round(d.revenue_ht)} euros`).join(', ')}` },
      data.map((d) =>
        el('button', { class: 'bars__item', type: 'button', tabindex: '0', onclick: () => showTab('bookings') }, [
          el('span', { class: 'bars__tip' }, `${monthLabel(d.month)} · ${money(d.revenue_ht)} · ${d.bookings} course(s)`),
          el('span', { class: 'bars__fill', style: `height: ${Math.max(2, (d.revenue_ht / max) * 100)}%` }),
          el('span', { class: 'bars__label' }, monthLabel(d.month)),
        ])
      )
    )
  );
}

$('revenue-table-toggle').addEventListener('click', (e) => {
  const table = $('revenue-table');
  table.hidden = !table.hidden;
  e.target.setAttribute('aria-expanded', String(!table.hidden));
  e.target.textContent = table.hidden ? 'Voir le tableau' : 'Voir le graphique';
  $('revenue-chart').hidden = !table.hidden;
});

function renderRoutes() {
  const routes = state.stats.topRoutes;
  const node = $('top-routes');
  if (!routes.length) {
    node.replaceChildren(el('p', { class: 'empty' }, 'Aucun trajet enregistré.'));
    return;
  }
  const max = Math.max(...routes.map((r) => r.count), 1);
  node.replaceChildren(el('div', { class: 'rank' }, routes.map((r) =>
    el('div', { class: 'rank__row' }, [
      el('span', {}, `${r.pickup} → ${r.dropoff}`),
      el('span', { class: 'rank__value' }, `${r.count}× · ${money(r.revenue_ht)}`),
      el('span', { class: 'rank__track' }, el('span', { class: 'rank__fill', style: `width:${(r.count / max) * 100}%` })),
    ])
  )));
}

function renderRecent() {
  $('recent-bookings').replaceChildren(bookingsTable(state.bookings.slice(0, 6)));
  renderToday();
}

function renderToday() {
  const node = $('today-list');
  if (!node) return;
  const today = new Date().toDateString();
  const rides = state.bookings
    .filter((b) => b.pickup_at && new Date(b.pickup_at).toDateString() === today && b.status !== 'annule')
    .sort((a, b) => new Date(a.pickup_at) - new Date(b.pickup_at));

  if (!rides.length) return node.replaceChildren(el('p', { class: 'empty' }, 'Aucune course prévue aujourd\'hui.'));
  node.replaceChildren(el('div', { class: 'day__list' }, rides.map((b) =>
    el('button', { class: 'ride', type: 'button', onclick: () => bookingModal(b) }, [
      el('span', { class: 'ride__time' }, timeFmt.format(new Date(b.pickup_at))),
      el('span', {}, [
        el('span', { class: 'ride__trip' }, `${b.pickup || '—'} → ${b.dropoff || '—'}`),
        el('span', { class: 'ride__client' }, `${b.client_name || 'Client non renseigné'}${b.client_phone ? ' · ' + b.client_phone : ''}${b.price_ht ? ' · ' + money(b.price_ht) + ' HT' : ''}`),
      ]),
      statusChip(b.status),
    ])
  )));
}

/** CSV for accounting — Excel-friendly (semicolons, BOM, French decimals). */
$('export-csv').addEventListener('click', () => {
  const header = ['Référence', 'Statut', 'Service', 'Date', 'Heure', 'Client', 'Téléphone', 'Départ', 'Arrivée', 'Aller-retour', 'Km', 'Prix HT', 'TVA %'];
  const rows = state.bookings.map((b) => {
    const when = asDate(b.pickup_at);
    return [
      b.ref, STATUS[b.status] || b.status, SERVICE[b.service] || b.service,
      when ? dateFmt.format(when) : '', when ? timeFmt.format(when) : '',
      b.client_name || '', b.client_phone || '', b.pickup || '', b.dropoff || '',
      b.round_trip ? 'oui' : 'non',
      b.distance_km ?? '', String(b.price_ht ?? '').replace('.', ','), String(b.vat_rate ?? '').replace('.0', ''),
    ];
  });
  const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = '﻿' + [header, ...rows].map((row) => row.map(escape).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = el('a', { href: url, download: `aa-vtc-reservations-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`${rows.length} réservation(s) exportée(s)`);
});

/* ---------- Bookings ---------- */
function statusChip(status) {
  return el('span', { class: `chip chip--${status}` }, STATUS[status] || status);
}

/** Status can be changed straight from the list — the common daily action. */
function statusSelect(booking) {
  const node = el('select', { class: `status-select status-select--${booking.status}`, 'aria-label': `Statut de ${booking.ref}` },
    Object.entries(STATUS).map(([value, labelText]) => el('option', { value, selected: value === booking.status }, labelText)));
  node.addEventListener('change', async () => {
    const previous = booking.status;
    node.disabled = true;
    try {
      await api('/api/admin/bookings', { method: 'PATCH', body: { id: booking.id, status: node.value } });
      booking.status = node.value;
      node.className = `status-select status-select--${node.value}`;
      toast(`${booking.ref} · ${STATUS[node.value]}`);
      await loadStats();
      renderPlanning();
      renderToday();
    } catch {
      node.value = previous;
      toast('Erreur : statut non enregistré');
    } finally {
      node.disabled = false;
    }
  });
  return node;
}

function bookingsTable(rows) {
  if (!rows.length) return el('p', { class: 'empty' }, 'Aucune réservation.');
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'Réf.'), el('th', {}, 'Date'), el('th', {}, 'Client'),
      el('th', {}, 'Trajet'), el('th', { class: 'num' }, 'Prix HT'), el('th', {}, 'Statut'), el('th', {}, ''),
    ])),
    el('tbody', {}, rows.map((b) => {
      const when = asDate(b.pickup_at);
      return el('tr', {}, [
        el('td', { class: 'data__ref' }, b.ref),
        el('td', {}, when
          ? el('span', {}, [dateFmt.format(when), el('span', { class: 'data__sub' }, timeFmt.format(when))])
          : el('span', { class: 'data__sub' }, `Demande du ${dateFmt.format(asDate(b.created_at))}`)),
        el('td', {}, [b.client_name || '—', el('span', { class: 'data__sub' }, b.client_phone || '')]),
        el('td', {}, [
          `${b.pickup || '—'} → ${b.dropoff || '—'}`,
          el('span', { class: 'data__sub' }, `${SERVICE[b.service] || b.service}${b.round_trip ? ' · aller-retour' : ''}${b.distance_km ? ` · ${b.distance_km} km` : ''}`),
        ]),
        el('td', { class: 'num' }, money(b.price_ht)),
        el('td', {}, statusSelect(b)),
        el('td', {}, el('div', { class: 'row-actions' }, [
          el('button', { class: 'btn btn--line btn--sm', type: 'button', onclick: () => bookingModal(b) }, 'Ouvrir'),
        ])),
      ]);
    })),
  ]));
}

function renderBookings() {
  $('bookings-list').replaceChildren(bookingsTable(state.bookings));
}

function bookingModal(booking) {
  const isNew = !booking;
  const f = {
    name: input('b-name', { value: booking?.client_name || '', autocomplete: 'off' }),
    phone: input('b-phone', { value: booking?.client_phone || '', type: 'tel', autocomplete: 'off' }),
    email: input('b-email', { value: booking?.client_email || '', type: 'email', autocomplete: 'off' }),
    service: select('b-service', SERVICE, booking?.service || 'transfert'),
    status: select('b-status', STATUS, booking?.status || 'confirme'),
    pickup: input('b-pickup', { value: booking?.pickup || '' }),
    dropoff: input('b-dropoff', { value: booking?.dropoff || '' }),
    pickupAt: input('b-at', { type: 'datetime-local', value: toLocalInput(booking?.pickup_at) }),
    passengers: input('b-pax', { type: 'number', min: '1', max: '16', value: booking?.passengers ?? '' }),
    distanceKm: input('b-km', { type: 'number', min: '0', step: '0.1', value: booking?.distance_km ?? '' }),
    priceHt: input('b-price', { type: 'number', min: '0', step: '0.01', value: booking?.price_ht ?? '' }),
    vatRate: select('b-vat', { 10: 'TVA 10 % (transfert)', 20: 'TVA 20 % (mise à disposition, circuit)' }, String(booking?.vat_rate ?? 10).replace('.0', '')),
    roundTrip: input('b-rt', { type: 'checkbox', checked: Boolean(booking?.round_trip), style: 'width:auto' }),
    notes: el('textarea', { id: 'b-notes' }, booking?.notes || ''),
  };

  const content = el('div', { class: 'form-grid' }, [
    field('Client', f.name), field('Téléphone', f.phone),
    field('E-mail', f.email, { full: true }),
    field('Départ', f.pickup), field('Arrivée', f.dropoff),
    field('Date et heure', f.pickupAt), field('Passagers', f.passengers),
    field('Service', f.service), field('Statut', f.status),
    field('Distance (km)', f.distanceKm), field('Prix HT (€)', f.priceHt),
    field('TVA', f.vatRate, { full: true }),
    el('div', { class: 'full' }, el('label', { for: 'b-rt', style: 'display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--text)' }, [f.roundTrip, 'Aller-retour'])),
    field('Notes', f.notes, { full: true }),
  ]);

  const payload = () => ({
    name: f.name.value, phone: f.phone.value, email: f.email.value,
    service: f.service.value, status: f.status.value,
    pickup: f.pickup.value, dropoff: f.dropoff.value,
    pickupAt: f.pickupAt.value ? new Date(f.pickupAt.value).toISOString() : null,
    passengers: f.passengers.value || null,
    roundTrip: f.roundTrip.checked,
    distanceKm: f.distanceKm.value || null,
    priceHt: f.priceHt.value || null,
    vatRate: f.vatRate.value,
    notes: f.notes.value,
  });

  const actions = [];
  if (!isNew) {
    actions.push(el('button', { class: 'btn btn--line btn--sm spacer', type: 'button', onclick: () => { modal.close(); devisModal({ booking }); } }, 'Créer un devis'));
    actions.push(el('button', { class: 'btn btn--danger btn--sm', type: 'button', onclick: async () => {
      if (!confirm(`Supprimer la réservation ${booking.ref} ?`)) return;
      await api('/api/admin/bookings', { method: 'DELETE', body: { id: booking.id } });
      modal.close();
      toast('Réservation supprimée');
      await Promise.all([loadBookings(), loadStats()]);
    } }, 'Supprimer'));
  }
  actions.push(el('button', { class: 'btn btn--line', type: 'button', onclick: () => modal.close() }, 'Annuler'));
  actions.push(el('button', { class: 'btn btn--gold', type: 'button', onclick: async (e) => {
    e.target.disabled = true;
    try {
      if (isNew) await api('/api/admin/bookings', { method: 'POST', body: payload() });
      else await api('/api/admin/bookings', { method: 'PATCH', body: { id: booking.id, ...payload() } });
      modal.close();
      toast(isNew ? 'Réservation créée' : 'Réservation mise à jour');
      await Promise.all([loadBookings(), loadStats(), loadClients()]);
    } catch (err) {
      toast('Erreur : ' + (err.code || err.message));
      e.target.disabled = false;
    }
  } }, isNew ? 'Créer' : 'Enregistrer'));

  const modal = openModal({
    title: isNew ? 'Nouvelle réservation' : `Réservation ${booking.ref}`,
    content,
    actions,
  });
}

/* ---------- Planning ---------- */
function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
}

$('planning-prev').addEventListener('click', () => { state.weekStart.setDate(state.weekStart.getDate() - 7); renderPlanning(); });
$('planning-next').addEventListener('click', () => { state.weekStart.setDate(state.weekStart.getDate() + 7); renderPlanning(); });
$('planning-today').addEventListener('click', () => { state.weekStart = startOfWeek(new Date()); renderPlanning(); });

function renderPlanning() {
  const start = new Date(state.weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  $('planning-range').textContent = `Semaine du ${dateFmt.format(start)} au ${dateFmt.format(new Date(end - 1))}`;

  const today = new Date().toDateString();
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    return day;
  });

  $('planning-days').replaceChildren(...days.map((day) => {
    const rides = state.bookings
      .filter((b) => b.pickup_at && new Date(b.pickup_at).toDateString() === day.toDateString() && b.status !== 'annule')
      .sort((a, b) => new Date(a.pickup_at) - new Date(b.pickup_at));
    return el('section', { class: 'day' }, [
      el('div', { class: 'day__head' }, [
        el('h2', { class: `day__name${day.toDateString() === today ? ' day__name--today' : ''}` }, dayFmt.format(day)),
        el('span', { class: 'day__count' }, rides.length ? `${rides.length} course(s)` : 'Libre'),
      ]),
      el('div', { class: 'day__list' }, rides.map((b) =>
        el('button', { class: 'ride', type: 'button', onclick: () => bookingModal(b) }, [
          el('span', { class: 'ride__time' }, timeFmt.format(new Date(b.pickup_at))),
          el('span', {}, [
            el('span', { class: 'ride__trip' }, `${b.pickup || '—'} → ${b.dropoff || '—'}`),
            el('span', { class: 'ride__client' }, `${b.client_name || 'Client non renseigné'}${b.client_phone ? ' · ' + b.client_phone : ''}`),
          ]),
          statusChip(b.status),
        ])
      )),
    ]);
  }));
}

/* ---------- Clients ---------- */
function renderClients() {
  const rows = state.clients;
  const node = $('clients-list');
  if (!rows.length) return node.replaceChildren(el('p', { class: 'empty' }, 'Aucun client.'));
  node.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'Client'), el('th', {}, 'Contact'), el('th', { class: 'num' }, 'Courses'),
      el('th', { class: 'num' }, 'CA HT'), el('th', {}, 'Dernière course'), el('th', {}, ''),
    ])),
    el('tbody', {}, rows.map((c) => el('tr', {}, [
      el('td', {}, [c.name, c.notes ? el('span', { class: 'data__sub' }, c.notes) : null]),
      el('td', {}, [c.phone || '—', el('span', { class: 'data__sub' }, c.email || '')]),
      el('td', { class: 'num' }, c.bookings_count),
      el('td', { class: 'num' }, money(c.revenue_ht)),
      el('td', {}, c.last_booking ? dateFmt.format(asDate(c.last_booking)) : '—'),
      el('td', {}, el('div', { class: 'row-actions' }, [
        el('button', { class: 'btn btn--line btn--sm', type: 'button', onclick: () => devisModal({ client: c }) }, 'Devis'),
        el('button', { class: 'btn btn--line btn--sm', type: 'button', onclick: () => clientModal(c) }, 'Modifier'),
      ])),
    ]))),
  ])));
}

function clientModal(client) {
  const f = {
    name: input('c-name', { value: client.name || '' }),
    phone: input('c-phone', { value: client.phone || '', type: 'tel' }),
    email: input('c-email', { value: client.email || '', type: 'email' }),
    notes: el('textarea', { id: 'c-notes' }, client.notes || ''),
  };
  const modal = openModal({
    title: `Client · ${client.name}`,
    content: el('div', { class: 'form-grid' }, [
      field('Nom', f.name), field('Téléphone', f.phone),
      field('E-mail', f.email, { full: true }),
      field('Notes', f.notes, { full: true }),
    ]),
    actions: [
      el('button', { class: 'btn btn--danger btn--sm spacer', type: 'button', onclick: async () => {
        if (!confirm(`Supprimer ${client.name} ? Les réservations sont conservées.`)) return;
        await api('/api/admin/clients', { method: 'DELETE', body: { id: client.id } });
        modal.close();
        toast('Client supprimé');
        await Promise.all([loadClients(), loadBookings()]);
      } }, 'Supprimer'),
      el('button', { class: 'btn btn--line', type: 'button', onclick: () => modal.close() }, 'Annuler'),
      el('button', { class: 'btn btn--gold', type: 'button', onclick: async () => {
        await api('/api/admin/clients', { method: 'PATCH', body: {
          id: client.id, name: f.name.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value,
        } });
        modal.close();
        toast('Client mis à jour');
        await Promise.all([loadClients(), loadBookings()]);
      } }, 'Enregistrer'),
    ],
  });
}

/* ---------- Devis ---------- */
function renderDevis() {
  const rows = state.devis;
  const node = $('devis-list');
  if (!rows.length) return node.replaceChildren(el('p', { class: 'empty' }, 'Aucun devis. Créez-en un depuis une réservation, un client, ou avec « Nouveau devis ».'));
  node.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'data' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'N°'), el('th', {}, 'Date'), el('th', {}, 'Client'),
      el('th', { class: 'num' }, 'Total HT'), el('th', { class: 'num' }, 'Total TTC'), el('th', {}, 'Validité'), el('th', {}, ''),
    ])),
    el('tbody', {}, rows.map((d) => el('tr', {}, [
      el('td', { class: 'data__ref' }, d.number),
      el('td', {}, dateFmt.format(asDate(d.created_at))),
      el('td', {}, [d.client_name || '—', el('span', { class: 'data__sub' }, d.client_phone || '')]),
      el('td', { class: 'num' }, money(d.total_ht)),
      el('td', { class: 'num' }, money(d.total_ttc)),
      el('td', {}, d.valid_until ? dateFmt.format(asDate(d.valid_until)) : '—'),
      el('td', {}, el('div', { class: 'row-actions' }, [
        el('a', { class: 'btn btn--gold btn--sm', href: `/api/admin/devis?id=${d.id}&pdf=1`, target: '_blank', rel: 'noopener' }, 'PDF'),
        el('button', { class: 'btn btn--line btn--sm', type: 'button', title: 'Créer un nouveau devis à partir de celui-ci',
          onclick: () => devisModal({ duplicate: d }) }, 'Dupliquer'),
        el('button', { class: 'btn btn--danger btn--sm', type: 'button', onclick: async () => {
          if (!confirm(`Supprimer le devis ${d.number} ?`)) return;
          await api('/api/admin/devis', { method: 'DELETE', body: { id: d.id } });
          toast('Devis supprimé');
          await loadDevis();
        } }, 'Suppr.'),
      ])),
    ]))),
  ])));
}

$('new-devis').addEventListener('click', () => devisModal({}));

function devisModal({ booking, client, duplicate }) {
  const vatDefault = String(duplicate?.vat_rate ?? booking?.vat_rate ?? 20).replace('.0', '');
  const f = {
    name: input('d-name', { value: duplicate?.client_name || booking?.client_name || client?.name || '' }),
    phone: input('d-phone', { value: duplicate?.client_phone || booking?.client_phone || client?.phone || '', type: 'tel' }),
    email: input('d-email', { value: booking?.client_email || client?.email || '', type: 'email' }),
    vatRate: select('d-vat', { 10: 'TVA 10 % (transfert)', 20: 'TVA 20 % (mise à disposition, circuit)' }, vatDefault),
    validUntil: input('d-valid', { type: 'date', value: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) }),
    notes: el('textarea', { id: 'd-notes' }, duplicate?.notes || (booking ? `Trajet ${booking.pickup || ''} → ${booking.dropoff || ''}`.trim() : '')),
  };

  const linesBox = el('div', { class: 'lines' });
  const totals = el('div', { class: 'totals' });

  const addLine = (label = '', qty = 1, unitHt = '') => {
    const labelInput = el('input', { type: 'text', placeholder: 'Prestation', value: label, 'aria-label': 'Prestation' });
    const qtyInput = el('input', { type: 'number', min: '0.5', step: '0.5', value: qty, 'aria-label': 'Quantité' });
    const priceInput = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Prix HT', value: unitHt, 'aria-label': 'Prix unitaire HT' });
    const row = el('div', { class: 'line-row' }, [
      labelInput, qtyInput, priceInput,
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Supprimer la ligne', onclick: () => { row.remove(); updateTotals(); } }, '×'),
    ]);
    [labelInput, qtyInput, priceInput].forEach((i) => i.addEventListener('input', updateTotals));
    linesBox.append(row);
    updateTotals();
  };

  const readLines = () => [...linesBox.querySelectorAll('.line-row')].map((row) => {
    const [label, qty, unit] = row.querySelectorAll('input');
    return { label: label.value.trim(), qty: Number(qty.value), unitHt: Number(unit.value) };
  }).filter((l) => l.label && Number.isFinite(l.qty) && Number.isFinite(l.unitHt));

  function updateTotals() {
    const ht = readLines().reduce((sum, l) => sum + l.qty * l.unitHt, 0);
    const vat = ht * (Number(f.vatRate.value) / 100);
    totals.replaceChildren(
      el('div', {}, [el('span', {}, 'Total HT'), el('span', {}, money(ht))]),
      el('div', {}, [el('span', {}, `TVA ${f.vatRate.value} %`), el('span', {}, money(vat))]),
      el('div', { class: 'ttc' }, [el('span', {}, 'Total TTC'), el('span', {}, money(ht + vat))]),
    );
  }
  f.vatRate.addEventListener('change', updateTotals);

  const content = el('div', {}, [
    el('div', { class: 'form-grid' }, [
      field('Client', f.name), field('Téléphone', f.phone),
      field('E-mail', f.email), field('TVA', f.vatRate),
      field('Valable jusqu\'au', f.validUntil),
    ]),
    el('div', { style: 'margin-top:20px' }, [
      el('label', {}, 'Prestations'),
      linesBox,
      el('button', { class: 'btn btn--line btn--sm', type: 'button', style: 'margin-top:10px', onclick: () => addLine() }, '+ Ajouter une ligne'),
      totals,
    ]),
    el('div', { style: 'margin-top:16px' }, field('Notes', f.notes, { full: true })),
  ]);

  const modal = openModal({
    title: 'Nouveau devis',
    content,
    actions: [
      el('button', { class: 'btn btn--line', type: 'button', onclick: () => modal.close() }, 'Annuler'),
      el('button', { class: 'btn btn--gold', type: 'button', onclick: async (e) => {
        const lines = readLines();
        if (!lines.length) return toast('Ajoutez au moins une prestation.');
        e.target.disabled = true;
        try {
          const { devis } = await api('/api/admin/devis', { method: 'POST', body: {
            bookingId: booking?.id || null,
            clientId: client?.id || null,
            name: f.name.value, phone: f.phone.value, email: f.email.value,
            lines, vatRate: Number(f.vatRate.value),
            validUntil: f.validUntil.value, notes: f.notes.value,
          } });
          modal.close();
          await Promise.all([loadDevis(), loadClients()]);
          showTab('devis');
          toast(`Devis ${devis.number} créé`);
          window.open(`/api/admin/devis?id=${devis.id}&pdf=1`, '_blank', 'noopener');
        } catch (err) {
          toast('Erreur : ' + (err.code || err.message));
          e.target.disabled = false;
        }
      } }, 'Créer et télécharger le PDF'),
    ],
  });

  // Pre-fill from a duplicated devis, or from a booking
  if (duplicate) {
    try {
      for (const line of JSON.parse(duplicate.lines)) addLine(line.label, line.qty, line.unitHt);
    } catch { addLine(); }
  } else if (booking) {
    const label = booking.service === 'transfert'
      ? `Transfert ${booking.pickup || ''} → ${booking.dropoff || ''}`.trim()
      : `${SERVICE[booking.service] || 'Prestation'} ${booking.pickup || ''}`.trim();
    addLine(label, 1, booking.price_ht ?? '');
  } else {
    addLine();
  }
}

boot();
