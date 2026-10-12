# AA-VTC — Anywhere, Anytime.

Site vitrine avec estimation de tarif en ligne, hébergé sur **Cloudflare Workers** (plan gratuit).
`https://aa-vtc.fr` est l'adresse canonique ; `www` et les deux adresses en `.com` y sont redirigées (301).

Aucune clé d'API, aucune base de données, aucun compte : cartes, adresses et itinéraires viennent
d'**IGN Géoplateforme** (service public gratuit). Le site ne stocke rien.

## Arborescence

| Chemin | Rôle |
|---|---|
| `public/` | **Tout ce qui est publié** : page, styles, scripts, images, `_headers`, `robots.txt`, `sitemap.xml` |
| `worker.js` | Entrée Cloudflare : redirections canoniques, en-têtes de sécurité, route `/api/fare` |
| `api/fare.js` | Estimation : géocodage + itinéraire IGN, puis tarif |
| `api/_lib/pricing.js` | Tarifs et TVA (source unique) |
| `api/_lib/guard.js` | Protection anti-abus : origine, clients automatisés, quotas |
| `dev-server.mjs` | Serveur local Node équivalent au Worker |
| `wrangler.jsonc` | Configuration Cloudflare (nom `aa-vtc`, domaines, assets, limite de débit) |

Le code serveur est **hors de `public/`** : il ne peut pas être servi comme fichier.

## Commandes

```bash
npm run dev       # http://localhost:3000  — serveur Node
npm run preview   # http://localhost:8787  — vrai runtime Workers
npm run deploy    # déploiement Cloudflare
```

## Sécurité

- **Surface minimale** : un seul point d'entrée serveur (`/api/fare`). Pas d'administration,
  pas de base de données, pas de mot de passe, pas de secret stocké.
- **En-têtes** : CSP stricte (aucun script tiers hormis la balise sans cookie de Cloudflare),
  HSTS, `X-Frame-Options: DENY`, `Permissions-Policy`, `nosniff`.
- **Anti-abus sur `/api/fare`** :
  - requête refusée sans en-tête `Origin` du site (bloque les appels croisés et la plupart des bots) ;
  - clients automatisés déclarés (curl, python-requests, scrapy…) refusés ;
  - **limite de débit Cloudflare** : 10 estimations/minute par IP (binding `FARE_LIMIT`), plus une
    limite mémoire de secours ; en cas d'erreur du limiteur, on laisse passer pour ne jamais
    bloquer un vrai visiteur.
- **DDoS** : absorbé par le réseau Cloudflare (protection L3/L4/L7 incluse dans le plan gratuit).

À activer dans le tableau de bord Cloudflare (gratuit, non scriptable) : **Bot Fight Mode**
(Security → Bots) et **Always Use HTTPS** (SSL/TLS → Edge Certificates), mode SSL **Full (strict)**.

## Tarifs (`api/_lib/pricing.js`)

Prix HT. Transfert local : 1,80 €/km, minimum 9,50 €, **TVA 10 %**.
Mise à disposition : 1 h/60 €, 4 h/300 €, 8 h/580 € — **TVA 20 %**, km supplémentaire 0,90 € (TVA 10 %).
Forfaits aéroports au départ du Havre (Orly 376, Roissy 410, Caen 120, Deauville 45) et circuits :
kilométrage inclus, **TVA 10 %**. L'estimateur propose automatiquement le forfait quand il s'applique.
