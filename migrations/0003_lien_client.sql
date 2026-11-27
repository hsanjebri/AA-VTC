-- Lien privé par document, pour que le client récupère sa facture lui-même.
--
-- Le jeton est la clé d'accès : il doit être imprévisible, donc tiré au hasard
-- sur 128 bits côté serveur. Surtout pas l'identifiant de la ligne, qui
-- s'énumère en comptant.
--
-- Le téléphone est conservé sous deux formes : telle que saisie, pour
-- l'affichage, et normalisée, parce qu'un même client écrit tantôt
-- « 06 12 34 56 78 », tantôt « +33612345678 ». C'est cette forme normalisée
-- qui servira d'identité quand le client cherchera ses factures.

ALTER TABLE documents ADD COLUMN jeton TEXT;
ALTER TABLE documents ADD COLUMN telephone TEXT;
ALTER TABLE documents ADD COLUMN telephone_norm TEXT;
ALTER TABLE documents ADD COLUMN consultations INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN vue_le TEXT;

-- L'échéance figurait sur la facture imprimée mais n'était pas conservée :
-- la copie remise au client en aurait été dépourvue, donc irrégulière.
ALTER TABLE documents ADD COLUMN echeance TEXT;

-- Un jeton ne doit jamais désigner deux documents.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_jeton ON documents (jeton);
CREATE INDEX IF NOT EXISTS idx_documents_tel ON documents (telephone_norm);
