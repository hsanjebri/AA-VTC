# AA-VTC — Anywhere, Anytime.

Site vitrine + estimation de tarif + administration privée.
Hébergé sur **Cloudflare Workers** (plan gratuit) : un Worker sert `/api/*`, le dossier `public/` est servi
en assets statiques. Aucune clé d'API payante : cartes, adresses et itinéraires viennent d'**IGN Géoplateforme**.

## Arborescence

| Chemin | Rôle |
|---|---|
| `public/` | **Tout ce qui est public** : site, `admin/`, `assets/`, `vendor/`, `_headers` |
| `worker.js` | Entrée Cloudflare : route `/api/*` vers `api/`, sert le reste via les assets |
| `api/*.js` | Points d'entrée publics : `fare` (estimation), `booking` (demande enregistrée) |
| `api/admin/*.js` | Tableau de bord : `auth`, `bookings`, `clients`, `stats`, `devis`, `signature` |
| `api/_lib/` | `pricing` (tarifs), `auth` (session, mot de passe), `db` (Postgres), `signature-data` |
| `public/admin/pdf.js` | Génération du devis PDF **dans le navigateur** de l'administrateur |
| `dev-server.mjs` | Serveur local Node (équivalent du Worker, avec base PGlite) |
| `wrangler.jsonc` | Configuration Cloudflare (nom `aa-vtc`, assets, variables) |

Le code serveur, `.dev.vars` et `private/` sont **hors de `public/`** : ils ne peuvent pas être servis.

## Commandes

```bash
npm run dev         # http://localhost:3000  — Node + base locale PGlite
npm run preview     # http://localhost:8787  — vrai runtime Workers (wrangler dev)
npm run deploy      # déploiement Cloudflare
npm run hash-password -- "mot de passe"   # génère ADMIN_PASSWORD_HASH + SESSION_SECRET
```

## Variables

Non secrètes dans `wrangler.jsonc` (`vars`) : `ADMIN_EMAIL`, `ALLOWED_ORIGINS`, `COMPANY_*`.
Secrets via `npx wrangler secret put NOM` :

| Secret | Rôle |
|---|---|
| `DATABASE_URL` | Postgres Neon (sans lui, le tableau de bord ne fonctionne pas) |
| `ADMIN_PASSWORD_HASH` | `v2$600000$<sel>$<sha256>` produit par `npm run hash-password` |
| `SESSION_SECRET` | 32 caractères minimum, signe le cookie de session |

En local, mettre les mêmes valeurs dans `.dev.vars` (ignoré par git).

## Sécurité

- **Mot de passe** : PBKDF2-SHA256, 600 000 tours, calculé **dans le navigateur** ; le serveur ne compare
  qu'un SHA-256. Le budget CPU du plan gratuit (10 ms) est respecté sans affaiblir le stockage : un hash volé
  coûte toujours 600 000 tours par essai.
- **Session** : cookie `__Host-aa_admin`, HttpOnly, `SameSite=Strict`, Secure, signé HMAC, 12 h.
- **En-têtes** (`public/_headers`) : CSP stricte (pas de `unsafe-eval`, pas de script tiers), HSTS,
  `X-Frame-Options: DENY`, `Permissions-Policy`, `nosniff`.
- **Limites** : 20 estimations/minute par visiteur, 8 tentatives de connexion/10 min.
- `/admin` : `noindex`, `no-store`, et robots.txt l'exclut.
- La **signature manuscrite** n'est jamais un fichier public : elle est servie par `/api/admin/signature`
  uniquement à une session valide.

## Tarifs (`api/_lib/pricing.js`)

Prix HT. Transfert local : 1,80 €/km, minimum 9,50 €, **TVA 10 %**.
Mise à disposition : 1 h/60 €, 4 h/300 €, 8 h/580 € — **TVA 20 %**, km supplémentaire 0,90 € (TVA 10 %).
Forfaits aéroports au départ du Havre (Orly 376, Roissy 410, Caen 120, Deauville 45) et circuits :
kilométrage inclus, **TVA 10 %**. L'estimateur propose automatiquement le forfait quand il s'applique.

## Base de données

Postgres (Neon) via `DATABASE_URL` ; les tables sont créées au premier appel.
En local sans `DATABASE_URL`, une base embarquée (PGlite) est utilisée dans `.pglite/`.

Données personnelles : le tableau de bord conserve nom, téléphone et e-mail des clients.
Prévoir une politique de conservation et d'effacement (RGPD).
