-- Ajout du type FACTURE, pour les clients professionnels.
--
-- Une note suffit à un particulier ; une entreprise a besoin d'une facture
-- portant les mentions de règlement de l'article L441-9 du code de commerce.
-- SQLite ne sait pas modifier une contrainte CHECK : il faut reconstruire la
-- table. Les données sont recopiées, rien n'est perdu.

ALTER TABLE documents RENAME TO documents_old;

CREATE TABLE documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  numero           TEXT    NOT NULL UNIQUE,   -- 2026-0001
  annee            INTEGER NOT NULL,
  sequence         INTEGER NOT NULL,
  type             TEXT    NOT NULL CHECK (type IN ('NOTE', 'FACTURE', 'DEVIS')),

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

INSERT INTO documents SELECT * FROM documents_old;
DROP TABLE documents_old;

-- Les index suivaient l'ancienne table : on les recrée.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_sequence ON documents (annee, sequence);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents (date_doc DESC);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents (client);
