-- Journal des courses : une ligne par note ou devis émis.
-- La numérotation est attribuée par le serveur, pas par le navigateur :
-- une suite continue est une obligation sur les factures, et le compteur
-- local disparaissait au moindre vidage de cache.

CREATE TABLE IF NOT EXISTS documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  numero           TEXT    NOT NULL UNIQUE,   -- 2026-0001
  annee            INTEGER NOT NULL,
  sequence         INTEGER NOT NULL,
  type             TEXT    NOT NULL CHECK (type IN ('NOTE', 'DEVIS')),

  date_doc         TEXT    NOT NULL,          -- AAAA-MM-JJ
  date_course      TEXT,
  heure            TEXT,

  client           TEXT,
  client_info      TEXT,

  depart           TEXT,
  arrivee          TEXT,
  passagers        INTEGER DEFAULT 1,

  prestation       TEXT    NOT NULL,          -- transfert | forfait | circuit | miseadispo
  detail           TEXT,
  aller_retour     INTEGER NOT NULL DEFAULT 0,
  km               REAL,

  prix_ht          REAL    NOT NULL DEFAULT 0,
  supplement_ht    REAL    NOT NULL DEFAULT 0,
  supplement_label TEXT,
  taux_tva         INTEGER NOT NULL,
  total_ht         REAL    NOT NULL,
  montant_tva      REAL    NOT NULL,
  total_ttc        REAL    NOT NULL,

  paiement         TEXT,
  cree_le          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Une seule séquence par année : garantit l'absence de trou et de doublon.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_sequence ON documents (annee, sequence);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents (date_doc DESC);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents (client);
