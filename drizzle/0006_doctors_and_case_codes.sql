-- Новое дополнение к ТЗ: справочник врачей и человекочитаемый код операции.
--
-- Код операции получает вид «<код врача><номер из 5 цифр>» (CH00001, CH00002, …). Номер
-- сквозной ПО КАЖДОМУ ВРАЧУ и выдаётся тем же счётчиком code_sequences, что и
-- ITM/PCK: считать по COUNT(*) нельзя — удаление или архивирование операции
-- выдало бы уже занятый номер.
--
-- random_case_code сохраняется: §7.3/§18.4 требуют идентификатор, не выводимый
-- ни из каких данных, и он остаётся внутренним ключом строки. Пользователю
-- показывается case_code.

CREATE TABLE doctors (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Префикс кода операции. Две буквы по умолчанию, но поле редактируемое,
  -- поэтому длина ограничена диапазоном, а не константой.
  code                   TEXT    NOT NULL,
  last_name              TEXT    NOT NULL,
  full_name              TEXT,
  status                 TEXT    NOT NULL DEFAULT 'active',
  archived_at            INTEGER,
  archived_by_account_id INTEGER REFERENCES user_accounts(id),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  CHECK (status IN ('active', 'inactive')),
  CHECK (length(code) BETWEEN 2 AND 4),
  CHECK (code = upper(code))
);

CREATE UNIQUE INDEX ux_doctors_code ON doctors (code);
CREATE INDEX ix_doctors_status ON doctors (status);
CREATE INDEX ix_doctors_last_name ON doctors (last_name);

ALTER TABLE operations ADD COLUMN doctor_id INTEGER REFERENCES doctors(id);
-- Снимки: архивирование или переименование врача не должно менять то, что
-- написано в уже созданной операции.
ALTER TABLE operations ADD COLUMN doctor_code_snapshot TEXT;
ALTER TABLE operations ADD COLUMN doctor_name_snapshot TEXT;
ALTER TABLE operations ADD COLUMN case_number INTEGER;
ALTER TABLE operations ADD COLUMN case_code TEXT;

-- Операции, созданные до появления справочника, сохраняют свой прежний код:
-- переписать их на врачебный код невозможно — врач у них не был указан.
UPDATE operations SET case_code = random_case_code WHERE case_code IS NULL;

CREATE UNIQUE INDEX ux_operations_case_code_display ON operations (case_code);
CREATE INDEX ix_operations_doctor ON operations (doctor_id, created_at);
