-- Qui a émis le document.
--
-- Avec une clé unique partagée, le journal ne pouvait dire que « quelqu'un ».
-- Chaque personne a maintenant sa propre clé, donc chaque document porte le
-- nom de celui qui l'a établi — et retirer l'accès à quelqu'un ne force plus
-- tout le monde à changer de clé.

ALTER TABLE documents ADD COLUMN emis_par TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_emetteur ON documents (emis_par);
