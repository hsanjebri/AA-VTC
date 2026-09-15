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
- Transfer: `km × 1,80 €` (TVA 10 %), distance by road, doubled for *aller-retour*.
- Forfaits (1 h/60 €/20 km, Overlord 4 h/300 €/70 km, Utah & Omaha 8 h/580 €/150 km) are suggested when they cover the whole trip (km and driving time) and are cheaper — or, for a round trip, as the "driver waits on site" alternative.
- The page states "Estimation, tarif final confirmé par SMS/WhatsApp".

## Degraded modes
- Suggestions unavailable → fields still work as free text (the server geocodes them).
- Routing unavailable → message + "Demander un tarif sur WhatsApp" with the addresses pre-filled.
- Map unavailable → styled fallback panel.

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
