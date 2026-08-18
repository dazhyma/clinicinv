-- Patient ID хранится только как authenticated ciphertext. Старые surgeries
-- остаются с NULL; выдуманные значения миграция не создаёт.
ALTER TABLE operations ADD COLUMN patient_id_encrypted TEXT;
ALTER TABLE operations ADD COLUMN patient_id_lookup TEXT;

CREATE INDEX ix_operations_patient_id_lookup
  ON operations(patient_id_lookup)
  WHERE patient_id_lookup IS NOT NULL;
