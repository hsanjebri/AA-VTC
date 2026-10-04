// Database layer. Production: Neon Postgres (DATABASE_URL). Local dev/tests: embedded Postgres (PGlite).
// Files prefixed with "_" are not exposed as routes by Vercel.

let queryFn = null;
let schemaReady = null;

async function connect() {
  if (queryFn) return queryFn;

  const url = process.env.DATABASE_URL;
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    // neon's query() takes (text, params) and returns rows
    queryFn = async (text, params = []) => sql.query(text, params);
  } else {
    // Local fallback so the dashboard runs without a cloud database.
    // The package name is built at runtime so the Vercel bundler never tries to include this dev dependency.
    const name = ['@electric-sql', 'pglite'].join('/');
    const { PGlite } = await import(name);
    const dir = process.env.PGLITE_DIR || './.pglite';
    const db = new PGlite(dir);
    await db.waitReady;
    queryFn = async (text, params = []) => (await db.query(text, params)).rows;
  }
  return queryFn;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clients_phone_key ON clients (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS bookings (
  id           SERIAL PRIMARY KEY,
  ref          TEXT UNIQUE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'nouveau',
  service      TEXT NOT NULL DEFAULT 'transfert',
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  pickup       TEXT,
  dropoff      TEXT,
  pickup_at    TIMESTAMPTZ,
  passengers   INTEGER,
  round_trip   BOOLEAN NOT NULL DEFAULT false,
  distance_km  NUMERIC(8,1),
  duration_min INTEGER,
  price_ht     NUMERIC(10,2),
  vat_rate     NUMERIC(4,1),
  notes        TEXT,
  source       TEXT NOT NULL DEFAULT 'site',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_pickup_at_idx ON bookings (pickup_at);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings (status);

CREATE TABLE IF NOT EXISTS devis (
  id           SERIAL PRIMARY KEY,
  number       TEXT UNIQUE NOT NULL,
  booking_id   INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  lines        TEXT NOT NULL,
  total_ht     NUMERIC(10,2) NOT NULL,
  vat_rate     NUMERIC(4,1) NOT NULL,
  total_ttc    NUMERIC(10,2) NOT NULL,
  valid_until  DATE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
`;

/** Runs the schema once per cold start. CREATE ... IF NOT EXISTS keeps it safe to repeat. */
export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const run = await connect();
      for (const statement of SCHEMA.split(';')) {
        const text = statement.trim();
        if (text) await run(text);
      }
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

/** sql`SELECT * FROM bookings WHERE id = ${id}` → parameterised query, never string-concatenated. */
export async function sql(strings, ...values) {
  await ensureSchema();
  const run = await connect();
  const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
  return run(text, values);
}

/** Next value of a named counter, e.g. "booking-2026" → 1, 2, 3 … */
export async function nextCounter(name) {
  const rows = await sql`
    INSERT INTO counters (name, value) VALUES (${name}, 1)
    ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  return rows[0].value;
}

export async function nextRef(prefix) {
  const year = new Date().getFullYear();
  const n = await nextCounter(`${prefix}-${year}`);
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}
