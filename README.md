# AA-VTC — Anywhere, Anytime.

Single-page site for AA-VTC (private chauffeur, Normandy): static HTML/CSS/JS + one Vercel serverless function.
**No API key and no billing account needed** — maps, address suggestions and routing use free public services.

## Files
| Path | Role |
|---|---|
| `index.html`, `styles.css`, `script.js` | Page, design, hero carousel / nav / WhatsApp links |
| `maps.js` | Fare estimator (address suggestions) + service-area map (Leaflet) |
| `vendor/leaflet/` | Leaflet 1.9.4 (self-hosted, loaded only when the map approaches the viewport) |
| `api/fare.js` | `POST /api/fare` — geocoding + road distance (IGN) → price |
| `api/booking.js` | `POST /api/booking` — records a booking request from the site |
| `api/admin/*.js` | Dashboard API: auth, bookings, clients, stats, devis (PDF) |
| `admin/` | The dashboard itself (login + 5 tabs), vanilla JS |
| `scripts/hash-password.mjs` | Generates ADMIN_PASSWORD_HASH and SESSION_SECRET |
| `api/_lib/pricing.js` | Tariffs & forfait logic (single source of truth) |
| `dev-server.mjs` | Local server (site + `/api`) |

## Services used
| Need | Service | Notes |
|---|---|---|
| Map | **Leaflet** + **Plan IGN v2** tiles (`data.geopf.fr/wmts`) | Free, open data, attribution "© IGN" shown on the map. Tinted navy/gold with a CSS filter (`.map-tiles` in `styles.css`). |
| Address suggestions | **IGN Géoplateforme geocoding** (`data.geopf.fr/geocodage/search`) | Addresses (BAN) + places (stations, beaches, towns…). France only. Called from the browser. |
| Distance / duration | **IGN Géoplateforme routing** (`data.geopf.fr/navigation/itineraire`, `bdtopo-osrm`, car) | Called by `/api/fare`. France only: trips with a start/end that can't be reached by road (sea, abroad) are rejected. |

These are public services with fair-use rate limits; `/api/fare` accepts only same-site requests and max 20 estimates/minute per visitor.

## Pricing logic (`api/_lib/pricing.js`)
All prices are HT (hors taxes).

- **Transfert local**: `km × 1,80 € HT`, minimum `9,50 € HT`, TVA 10 %. Distance by road, doubled for *aller-retour*.
- **Mise à disposition** (TVA 20 %): 1 h / 60 € HT / 20 km, 4 h / 300 € HT / 70 km, 8 h / 580 € HT / 200 km. Km supplémentaire : 0,90 € HT. Suggested when a forfait covers the whole trip (km and driving time) and is cheaper — or, for a round trip, as the "driver waits on site" alternative.
- **Les forfaits** (fixed prices from Le Havre, TVA 20 %) and **circuits touristiques** (Mont Saint-Michel ~10 h / 620 € HT; D-Day and Loire sur devis) are shown in the tarifs table in `index.html` only — the estimator does not compute them.
- The page states "Estimation, tarif final confirmé par SMS/WhatsApp".

## Degraded modes
- Suggestions unavailable → fields still work as free text (the server geocodes them).
- Routing unavailable → message + "Demander un tarif sur WhatsApp" with the addresses pre-filled.
- Map unavailable → styled fallback panel.

## Administration (`/admin`)

Private dashboard: bookings, planning, clients, revenue and devis (PDF).

| Need | How |
|---|---|
| Login | One account. `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (scrypt), signed HttpOnly session cookie (12 h), max 8 login attempts / 10 min / IP, `noindex` + robots.txt |
| Database | Postgres via `DATABASE_URL` (Neon). Tables are created automatically on first use. Locally, with no `DATABASE_URL`, an embedded Postgres (PGlite, dev dependency) is used and stored in `.pglite/` |
| Bookings | Requests from the site land as `nouveau` (the estimator posts to `/api/booking` when the visitor clicks "Réserver ce trajet"); add or edit them by hand in the dashboard |
| Devis | Lines + TVA → numbered `DV-YYYY-NNNN`, PDF generated server-side (pdf-lib) |

### Setup
1. **Database** — Vercel → Storage → create a Neon Postgres database → it adds `DATABASE_URL` to the project.
2. **Account** — run `node scripts/hash-password.mjs "votre-mot-de-passe"` and copy the three printed variables into Vercel → Settings → Environment Variables (and into `.env.local` for local use).
3. Redeploy, then open `https://www.aa-vtc.fr/admin`.

Data protection: the dashboard stores client names, phones and emails. Keep the password private, and plan a retention/erasure policy (GDPR).

## Run locally
```bash
npm run dev      # http://localhost:3000 (site + /api)
```
`PORT=3100 npm run dev` if port 3000 is taken. **Do not double-click `index.html` or use `python -m http.server`**: without `/api` the fare estimate cannot work.

## Deploy
`vercel --prod`, or push to GitHub and import on vercel.com (Framework preset: *Other*, no build command, output directory `.`). Optionally set `ALLOWED_ORIGINS`.

## Editing
- WhatsApp number / default message: top of `script.js` and `maps.js` (`WA_NUMBER`).
- Tariffs: `api/_lib/pricing.js` (and the displayed prices in `index.html`).
- Map places: `PLACES` in `maps.js`; map colours: `.service-map .map-tiles` filter in `styles.css`.
- QR code: replace the `.qr` placeholder in the Contact section with an image pointing to `https://wa.me/33652807488`.
