import { matchPlaces, rankScore } from './places.js';

(() => {
  const WA_NUMBER = '33652807488';
  const GEOCODE_URL = 'https://data.geopf.fr/geocodage/search';
  const IGN_TILES = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
    + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png'
    + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

  const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const km = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const waLink = (text) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;
  const formatDuration = (min) => {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  };

  /* =========================================================
     Address suggestions — IGN Géoplateforme geocoding (addresses + places, France)
     ========================================================= */
  const first = (value) => (Array.isArray(value) ? value[0] : value) || '';

  function toSuggestions(features, query) {
    const curated = matchPlaces(query, 2).map((p) => ({ main: p.name, sub: p.hint, label: p.name, lat: p.lat, lng: p.lng }));
    const seen = new Set(curated.map((item) => item.label.toLowerCase()));
    const found = features.flatMap((feature) => {
      const p = feature.properties || {};
      const [lng, lat] = feature.geometry?.coordinates || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

      const isPlace = p._type === 'poi';
      const main = isPlace ? first(p.toponym) || first(p.name) : p.name || p.label;
      if (!main) return [];
      const city = first(p.city);
      const postcode = first(p.postcode);
      const inOtherCity = city && city !== main;
      const place = inOtherCity ? `${postcode} ${city}`.trim() : postcode;
      const label = place ? (inOtherCity ? `${main}, ${place}` : `${main} (${place})`) : main;
      const category = first(p.category);
      const sub = isPlace
        ? [place, category && category[0].toUpperCase() + category.slice(1)].filter(Boolean).join(' · ')
        : p.context || place;

      return [{ main, sub, label, lat, lng, rank: rankScore(p.score, { lat, lng }) }];
    });

    const ranked = found
      .sort((a, b) => b.rank - a.rank)
      .filter((item) => {
        const key = item.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return [...curated, ...ranked].slice(0, 5);
  }

  class PlaceField {
    constructor(input, onEdit) {
      this.input = input;
      this.list = document.getElementById(input.getAttribute('aria-controls'));
      this.error = document.getElementById(`${input.id}-error`);
      this.onEdit = onEdit;
      this.selected = null;
      this.items = [];
      this.active = -1;
      this.debounce = 0;
      this.controller = null;

      input.addEventListener('input', () => this.handleInput());
      input.addEventListener('keydown', (e) => this.handleKey(e));
      input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
      this.list.addEventListener('mousedown', (e) => e.preventDefault());
      this.list.addEventListener('click', (e) => {
        const option = e.target.closest('[role="option"]');
        if (option) this.choose(Number(option.dataset.index));
      });
    }

    get label() { return this.input.value.trim(); }

    get waypoint() {
      if (this.selected && this.selected.label === this.input.value) {
        return { lat: this.selected.lat, lng: this.selected.lng };
      }
      return this.label.length >= 3 ? { address: this.label } : null;
    }

    setError(message) {
      this.input.setAttribute('aria-invalid', message ? 'true' : 'false');
      this.error.textContent = message || '';
      this.error.hidden = !message;
    }

    handleInput() {
      this.selected = null;
      this.setError('');
      this.onEdit();
      clearTimeout(this.debounce);
      const query = this.label;
      if (query.length < 3) {
        this.controller?.abort();
        return this.close();
      }
      this.debounce = setTimeout(() => this.fetchSuggestions(query), 250);
    }

    async fetchSuggestions(query) {
      this.controller?.abort();
      const controller = (this.controller = new AbortController());
      try {
        const params = new URLSearchParams({ q: query, autocomplete: '1', index: 'address,poi', limit: '10' });
        const res = await fetch(`${GEOCODE_URL}?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { features = [] } = await res.json();
        if (document.activeElement !== this.input) return;
        this.items = toSuggestions(features, query);
        this.render();
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Service down: still offer the curated places; the field also works as free text (the server geocodes it).
        console.warn('[AJ-VTC] Suggestions indisponibles :', err);
        if (document.activeElement !== this.input) return;
        this.items = toSuggestions([], query);
        this.render();
      }
    }

    render() {
      this.list.replaceChildren();
      this.active = -1;
      this.input.removeAttribute('aria-activedescendant');
      if (!this.items.length) return this.close();

      this.items.forEach((item, i) => {
        const li = document.createElement('li');
        li.id = `${this.input.id}-option-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.index = String(i);
        const main = document.createElement('span');
        main.className = 'combo__main';
        main.textContent = item.main;
        const sub = document.createElement('span');
        sub.className = 'combo__sub';
        sub.textContent = item.sub;
        li.append(main, sub);
        this.list.append(li);
      });

      const credit = document.createElement('li');
      credit.className = 'combo__credit';
      credit.setAttribute('role', 'presentation');
      credit.textContent = 'Adresses : IGN Géoplateforme';
      this.list.append(credit);

      this.list.hidden = false;
      this.input.setAttribute('aria-expanded', 'true');
    }

    move(delta) {
      const options = this.list.querySelectorAll('[role="option"]');
      if (!options.length) return;
      options[this.active]?.setAttribute('aria-selected', 'false');
      this.active = (this.active + delta + options.length) % options.length;
      const current = options[this.active];
      current.setAttribute('aria-selected', 'true');
      current.scrollIntoView({ block: 'nearest' });
      this.input.setAttribute('aria-activedescendant', current.id);
    }

    handleKey(e) {
      const open = !this.list.hidden;
      if (e.key === 'ArrowDown' && open) { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp' && open) { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter' && open && this.active >= 0) { e.preventDefault(); this.choose(this.active); }
      else if (e.key === 'Escape') { if (open) e.preventDefault(); this.close(); } // also cancels a pending lookup
    }

    choose(index) {
      const item = this.items[index];
      if (!item) return;
      clearTimeout(this.debounce);
      this.controller?.abort();
      this.input.value = item.label;
      this.selected = item;
      this.setError('');
      this.close();
      this.onEdit();
    }

    close() {
      // Cancel any pending lookup, otherwise a late response re-opens the list after Escape/blur.
      clearTimeout(this.debounce);
      this.controller?.abort();
      this.list.hidden = true;
      this.input.setAttribute('aria-expanded', 'false');
      this.input.removeAttribute('aria-activedescendant');
      this.active = -1;
    }

    swapWith(other) {
      [this.input.value, other.input.value] = [other.input.value, this.input.value];
      [this.selected, other.selected] = [other.selected, this.selected];
      this.setError('');
      other.setError('');
    }
  }

  /** Encoded polyline (precision 5) → [[lat, lng], …] */
  function decodePolyline(str) {
    const points = [];
    let index = 0, lat = 0, lng = 0;
    while (index < str.length) {
      for (let i = 0; i < 2; i++) {
        let shift = 0, result = 0, byte;
        do {
          byte = str.charCodeAt(index++) - 63;
          result |= (byte & 0x1f) << shift;
          shift += 5;
        } while (byte >= 0x20);
        const delta = result & 1 ? ~(result >> 1) : result >> 1;
        if (i === 0) lat += delta; else lng += delta;
      }
      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  }

  /** Draws the estimated route on a small map under the estimator. */
  let routeMap = null;
  let routeLayers = [];
  async function showRoute(q, labels) {
    const frame = document.getElementById('fare-map');
    if (!frame || !q.route) return;
    try {
      const L = await loadLeaflet();
      frame.hidden = false;
      if (!routeMap) {
        routeMap = L.map(frame, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
        routeMap.setView([49.1, -0.4], 8); // a view must exist before layers are added
        routeMap.attributionControl.setPrefix(false);
        L.tileLayer(IGN_TILES, {
          minZoom: 5, maxZoom: 18,
          attribution: '<a href="https://www.ign.fr/" target="_blank" rel="noopener">© IGN</a> Géoplateforme · <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>',
        }).addTo(routeMap);
        routeMap.on('click', () => routeMap.scrollWheelZoom.enable());
        routeMap.on('mouseout', () => routeMap.scrollWheelZoom.disable());
      }

      routeLayers.forEach((layer) => routeMap.removeLayer(layer));
      routeLayers = [];

      const points = decodePolyline(q.route);
      const line = L.polyline(points, { color: '#0B1E3D', weight: 5, opacity: 0.9 }).addTo(routeMap);
      const halo = L.polyline(points, { color: '#C9A24B', weight: 9, opacity: 0.35 }).addTo(routeMap);
      // Addresses come from user input: escape them before they go anywhere near HTML.
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const pin = (point, label, kind) => L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: `route-pin route-pin--${kind}`,
          html: `<span class="route-pin__dot"></span><span class="route-pin__label">${escapeHtml(label)}</span>`,
          iconSize: [0, 0],
        }),
        keyboard: false,
        interactive: false,
      }).addTo(routeMap);

      const start = pin(q.from, labels.from, 'start');
      const end = pin(q.to, labels.to, 'end');
      routeLayers = [halo, line, start, end];

      routeMap.invalidateSize();
      routeMap.fitBounds(line.getBounds(), { padding: [34, 34] });
    } catch (err) {
      console.warn('[AJ-VTC] Carte de l\'itinéraire indisponible :', err);
      frame.hidden = true;
    }
  }

  /* =========================================================
     Fare estimator
     ========================================================= */
  function initEstimator() {
    const form = document.getElementById('fare-form');
    if (!form) return;

    const result = document.getElementById('fare-result');
    const panels = {
      idle: result.querySelector('.fare-idle'),
      done: result.querySelector('.fare-done'),
      error: result.querySelector('.fare-error'),
    };
    const submit = document.getElementById('fare-submit');
    const submitLabel = submit.querySelector('.btn__label');
    const roundTrip = document.getElementById('fare-return');
    let busy = false;

    const show = (state) => {
      result.dataset.state = state;
      Object.entries(panels).forEach(([name, el]) => { el.hidden = name !== state; });
    };
    const onEdit = () => {
      if (busy || result.dataset.state === 'idle') return;
      show('idle');
      const map = document.getElementById('fare-map'); // the drawn route no longer matches the fields
      if (map) map.hidden = true;
    };

    const from = new PlaceField(document.getElementById('fare-from'), onEdit);
    const to = new PlaceField(document.getElementById('fare-to'), onEdit);

    document.getElementById('fare-swap').addEventListener('click', () => {
      from.swapWith(to);
      if (result.dataset.state === 'done') form.requestSubmit();
    });
    roundTrip.addEventListener('change', () => {
      if (result.dataset.state === 'done') form.requestSubmit();
    });

    const tripLines = () => [
      `Départ : ${from.label}`,
      `Arrivée : ${to.label}`,
      `Trajet : ${roundTrip.checked ? 'Aller-retour' : 'Aller simple'}`,
    ];

    function renderDone(q) {
      document.getElementById('fare-price').textContent = `${eur.format(q.price)} HT`;
      document.getElementById('fare-meta').textContent =
        `${km.format(q.distanceKm)} km · environ ${formatDuration(q.durationMin)} · ${q.roundTrip ? 'aller-retour' : 'aller simple'}`;
      document.getElementById('fare-breakdown').textContent = q.minFareApplied
        ? `Forfait minimum ${eur.format(q.minFare)} HT · TVA ${q.vatRate} %`
        : `${km.format(q.distanceKm)} km × ${eur.format(q.ratePerKm)} HT/km · TVA ${q.vatRate} %`;

      const suggest = document.getElementById('fare-suggest');
      suggest.replaceChildren();
      suggest.hidden = !q.suggestion && !q.airportForfait;

      // Fixed airport forfait (au départ du Havre) takes priority over the per-km price.
      if (q.airportForfait) {
        const f = q.airportForfait;
        const title = document.createElement('strong');
        title.textContent = `Forfait ${f.label}`;
        const line = document.createElement('p');
        line.textContent = `${eur.format(f.price)} HT par trajet (TVA ${f.vatRate} %)`
          + (q.roundTrip ? ` · ${eur.format(f.total)} HT l'aller-retour` : '')
          + (f.cheaper ? ` — soit ${eur.format(f.saving)} de moins qu'au kilomètre.` : '.');
        const link = document.createElement('a');
        link.className = 'link-arrow link-arrow--light';
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `Réserver le forfait ${f.label}`;
        link.href = waLink([
          `Bonjour AJ-VTC, je souhaite réserver le forfait ${f.label} (${eur.format(f.price)} HT par trajet).`,
          ...tripLines(),
          'Date : ', 'Heure : ', 'Nombre de passagers : ',
        ].join('\n'));
        suggest.append(title, line, link);
      }

      if (q.suggestion) {
        const f = q.suggestion.forfait;
        const title = document.createElement('strong');
        const text = document.createElement('p');
        const specs = `${f.hours} h, ${f.includedKm} km inclus${f.vatRate ? `, TVA ${f.vatRate} %` : ''}`;
        const forfaitPrice = `${eur.format(f.price)} HT`;
        if (q.suggestion.type === 'cheaper') {
          title.textContent = `Plus avantageux : mise à disposition ${f.name}`;
          text.textContent = `${forfaitPrice} (${specs}), soit ${eur.format(q.suggestion.savings)} de moins.`;
        } else {
          title.textContent = 'Le chauffeur vous attend sur place ?';
          text.textContent = `La mise à disposition ${f.name} (${specs}) couvre cet aller-retour : ${forfaitPrice}.`;
        }
        const link = document.createElement('a');
        link.className = 'link-arrow link-arrow--light';
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `Réserver la mise à disposition ${f.name}`;
        link.href = waLink([
          `Bonjour AJ-VTC, je souhaite réserver la mise à disposition ${f.name} (${f.hours} h, ${forfaitPrice}, ${f.includedKm} km inclus).`,
          ...tripLines(),
          'Date : ', 'Heure : ', 'Nombre de passagers : ',
        ].join('\n'));
        suggest.append(title, text, link);
      }

      const bookBtn = document.getElementById('fare-book');
      bookBtn.href = waLink([
        'Bonjour AJ-VTC, je souhaite réserver ce trajet :',
        ...tripLines(),
        `Distance : ${km.format(q.distanceKm)} km (environ ${formatDuration(q.durationMin)})`,
        q.airportForfait?.cheaper
          ? `Forfait ${q.airportForfait.label} : ${eur.format(q.airportForfait.price)} HT par trajet (TVA ${q.airportForfait.vatRate} %)`
          : `Estimation en ligne : ${eur.format(q.price)} HT (TVA ${q.vatRate} %)`,
        'Date : ', 'Heure : ', 'Nombre de passagers : ',
      ].join('\n'));

      show('done');
      showRoute(q, { from: from.label, to: to.label });
    }

    function renderError(code) {
      const messages = {
        not_found: 'Adresse introuvable. Vérifiez vos adresses ou choisissez une suggestion dans la liste.',
        no_route: 'Aucun itinéraire routier trouvé entre ces deux adresses en France.',
        invalid_input: 'Adresses incomplètes. Précisez le départ et l\'arrivée.',
        rate_limited: 'Trop de demandes en peu de temps. Réessayez dans une minute.',
      };
      document.getElementById('fare-error-msg').textContent = location.protocol === 'file:'
        ? 'Page ouverte en fichier local : l\'estimation a besoin du serveur. Lancez « npm run dev » puis ouvrez http://localhost:3000.'
        : messages[code] || 'L\'estimation en ligne est momentanément indisponible. Envoyez-nous votre trajet, nous vous répondons avec un tarif.';
      document.getElementById('fare-ask').href = waLink([
        'Bonjour AJ-VTC, pouvez-vous m\'indiquer le tarif de ce trajet ?',
        ...tripLines(),
        'Date : ', 'Heure : ', 'Nombre de passagers : ',
      ].join('\n'));
      show('error');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;

      const origin = from.waypoint;
      const destination = to.waypoint;
      from.setError(origin ? '' : 'Indiquez une adresse de départ.');
      to.setError(destination ? '' : 'Indiquez une adresse d\'arrivée.');
      if (!origin) return from.input.focus();
      if (!destination) return to.input.focus();

      busy = true;
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      result.setAttribute('aria-busy', 'true');
      submitLabel.textContent = 'Calcul en cours…';

      try {
        const res = await fetch('/api/fare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ origin, destination, roundTrip: roundTrip.checked }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || typeof data.price !== 'number') renderError(data.error);
        else renderDone(data);
      } catch {
        renderError('network');
      } finally {
        busy = false;
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
        result.removeAttribute('aria-busy');
        submitLabel.textContent = 'Calculer mon tarif';
      }
    });
  }

  /* =========================================================
     Service-area map (Contact) — Leaflet + IGN Plan tiles, loaded on demand
     ========================================================= */
  const PLACES = [
    { label: 'Mont-Saint-Michel', lat: 48.6361, lng: -1.5115, primary: true },
    { label: 'Cherbourg', lat: 49.6337, lng: -1.6222 },
    { label: 'Utah Beach', lat: 49.4131, lng: -1.1728, site: true },
    { label: 'Omaha Beach', lat: 49.3729, lng: -0.8787, site: true },
    { label: 'Bayeux', lat: 49.2764, lng: -0.7024 },
    { label: 'Caen', lat: 49.1829, lng: -0.3707 },
    { label: 'Deauville', lat: 49.36, lng: 0.075 },
    { label: 'Le Havre', lat: 49.4944, lng: 0.1079 },
    { label: 'Rouen', lat: 49.4431, lng: 1.0993 },
  ];

  let leafletPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    leafletPromise ||= new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet/leaflet.css';
      document.head.prepend(css); // before styles.css so the site's overrides win
      const script = document.createElement('script');
      script.src = 'vendor/leaflet/leaflet.js';
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error('Leaflet could not load'));
      document.head.append(script);
    });
    return leafletPromise;
  }

  async function initServiceMap() {
    const frame = document.querySelector('.service-map');
    const canvas = document.getElementById('service-map');
    if (!frame || !canvas) return;

    try {
      const L = await loadLeaflet();
      const map = L.map(canvas, {
        center: [49.1, -0.4],
        zoom: 8,
        zoomSnap: 0.25,
        zoomControl: false,
        scrollWheelZoom: false, // enabled on click, so the page scroll isn't hijacked
      });
      map.attributionControl.setPrefix(false);
      L.control.zoom({ position: 'topright', zoomInTitle: 'Zoom avant', zoomOutTitle: 'Zoom arrière' }).addTo(map);

      const tiles = L.tileLayer(IGN_TILES, {
        minZoom: 5,
        maxZoom: 18,
        className: 'map-tiles',
        attribution: '<a href="https://www.ign.fr/" target="_blank" rel="noopener">© IGN</a> Géoplateforme · <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>',
      }).addTo(map);
      tiles.once('tileload', () => frame.classList.add('is-ready'));

      L.circle([49.12, -0.35], {
        radius: 140000,
        color: '#c9a24b',
        weight: 1,
        opacity: 0.6,
        fillColor: '#c9a24b',
        fillOpacity: 0.03,
        interactive: false,
      }).addTo(map);

      PLACES.forEach((place) => {
        L.marker([place.lat, place.lng], {
          icon: L.divIcon({
            className: `map-pin${place.primary ? ' map-pin--primary' : ''}${place.site ? ' map-pin--site' : ''}`,
            html: `<span class="map-pin__dot"></span><span class="map-pin__label">${place.label}</span>`,
            iconSize: [0, 0],
          }),
          keyboard: false,
          interactive: false,
        }).addTo(map);
      });

      const bounds = L.latLngBounds(PLACES.map((p) => [p.lat, p.lng]));
      const fit = () => {
        const wide = canvas.clientWidth > 760;
        map.fitBounds(bounds, wide
          ? { paddingTopLeft: [420, 50], paddingBottomRight: [70, 50] }
          : { paddingTopLeft: [30, 30], paddingBottomRight: [30, 200] });
      };
      fit();

      map.on('click', () => map.scrollWheelZoom.enable());
      map.on('mouseout', () => map.scrollWheelZoom.disable());
      let resizeTimer = 0;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { map.invalidateSize(); fit(); }, 200);
      });
    } catch (err) {
      console.warn('[AJ-VTC] Carte indisponible :', err);
      // The styled fallback panel stays visible.
    }
  }

  function lazyInitMap() {
    const frame = document.querySelector('.service-map');
    if (!frame) return;
    if (!('IntersectionObserver' in window)) return void initServiceMap();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        initServiceMap();
      }
    }, { rootMargin: '400px' });
    io.observe(frame);
  }

  initEstimator();
  lazyInitMap();
})();
