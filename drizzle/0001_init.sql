-- Миграция 0001 — начальная схема.
-- Источник: ТЗ §17 (7 сущностей) + docs/data-model.md §8 (сущности, которых в §17 нет).
--
-- Соглашения:
--   * Деньги      — целые центы (INTEGER). REAL для сумм не используется нигде.
--   * Количества  — целые числа (INTEGER). ДОПУЩЕНИЕ, см. docs/decisions.md D-2.
--   * Время       — INTEGER, unix-миллисекунды UTC.
--   * Все уникальные ограничения — на уровне БД (docs/data-model.md §10), потому что
--     проверка «а нет ли уже такого?» в коде приложения не атомарна.

-- ---------------------------------------------------------------------------
-- Учётные записи и сессии (§17.7, §3.1, §15)
-- ---------------------------------------------------------------------------

CREATE TABLE user_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('Staff', 'Admin')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_login_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_user_accounts_username ON user_accounts (username);

-- Сессия хранится на сервере: §3.4 требует, чтобы выход и истечение сессии
-- никак не влияли на активную операцию, а §15 — чтобы токен нельзя было подделать.
-- В БД лежит только SHA-256 от токена; сам токен существует лишь в cookie.
CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash   TEXT    NOT NULL,
  account_id   INTEGER NOT NULL REFERENCES user_accounts (id),
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE UNIQUE INDEX ux_sessions_token_hash ON sessions (token_hash);
CREATE INDEX ix_sessions_account ON sessions (account_id);
CREATE INDEX ix_sessions_expires ON sessions (expires_at);

-- Ограничение попыток входа по паре (username, ip) — Q-36.
-- Блокировка по одному username остановила бы всю операционную: аккаунтов всего два.
CREATE TABLE login_attempts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL,
  ip              TEXT    NOT NULL,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  first_failed_at INTEGER,
  last_failed_at  INTEGER,
  locked_until    INTEGER,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_login_attempts_username_ip ON login_attempts (username, ip);

-- ---------------------------------------------------------------------------
-- Внутренние коды и штрихкоды (§5.5, §6.3, §18.5, §18.6)
-- ---------------------------------------------------------------------------

-- Счётчик номеров. Номер выдаётся через UPDATE ... RETURNING внутри той же
-- транзакции BEGIN IMMEDIATE, что и вставка предмета/пака: два параллельных
-- создания физически не могут получить один номер (§5.5 шаг 2, §21.1, AC-1.5).
-- Номер не переиспользуется даже после деактивации объекта (§5.5).
CREATE TABLE code_sequences (
  prefix     TEXT    PRIMARY KEY,
  next_value INTEGER NOT NULL
);
INSERT INTO code_sequences (prefix, next_value) VALUES ('ITM', 1), ('PCK', 1);

-- Единое пространство штрихкодов для предметов и паков (docs/data-model.md §1).
-- §16 запрещает «присваивать одинаковый штрихкод двум объектам» — это инвариант
-- данных, поэтому он выражен таблицей-реестром, а не соглашением о префиксах:
-- префиксы ITM-/PCK- ограничением БД не являются.
-- Строки отсюда никогда не удаляются: код не переиспользуется (§5.5).
-- Регистрация выполняется в той же транзакции, что и вставка объекта, поэтому
-- FK из items/packs сюда не ставится (иначе понадобился бы owner_id-заглушка).
CREATE TABLE barcode_registry (
  barcode_value TEXT    PRIMARY KEY,
  owner_type    TEXT    NOT NULL CHECK (owner_type IN ('item', 'pack')),
  owner_id      INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_barcode_registry_owner ON barcode_registry (owner_type, owner_id);

-- ---------------------------------------------------------------------------
-- Item (§17.1)
-- ---------------------------------------------------------------------------

CREATE TABLE items (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_code           TEXT    NOT NULL,
  barcode_value           TEXT    NOT NULL,
  name                    TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  photo_url               TEXT,
  sku                     TEXT,
  reference_number        TEXT,
  current_unit_cost_cents INTEGER NOT NULL CHECK (current_unit_cost_cents >= 0),
  unit_of_measurement     TEXT    NOT NULL,
  -- Денормализованный остаток. Инвариант: current_quantity == SUM(quantity_delta)
  -- по inventory_movements этого предмета. Прямая запись мимо журнала запрещена (§10.4).
  -- CHECK (>= 0) сознательно НЕ ставится: режим negative_stock_mode = 'warn' (§7.10)
  -- допускает отрицательный остаток при срочном сканировании.
  current_quantity        INTEGER NOT NULL DEFAULT 0,
  category                TEXT,
  storage_location        TEXT,
  low_stock_threshold     INTEGER,
  notes                   TEXT,
  status                  TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_items_internal_code ON items (internal_code);
CREATE UNIQUE INDEX ux_items_barcode_value ON items (barcode_value);
CREATE INDEX ix_items_sku ON items (sku);
CREATE INDEX ix_items_reference_number ON items (reference_number);
CREATE INDEX ix_items_name ON items (name);
CREATE INDEX ix_items_category ON items (category);
CREATE INDEX ix_items_storage_location ON items (storage_location);
CREATE INDEX ix_items_status ON items (status);
CREATE INDEX ix_items_current_quantity ON items (current_quantity);

-- ---------------------------------------------------------------------------
-- Pack + PackItem (§17.2, §17.3)
-- У пака нет ни остатка, ни хранимой стоимости — §6.5, §18.10, §6.4.
-- ---------------------------------------------------------------------------

CREATE TABLE packs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_code TEXT    NOT NULL,
  barcode_value TEXT    NOT NULL,
  name          TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  photo_url     TEXT,
  notes         TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_packs_internal_code ON packs (internal_code);
CREATE UNIQUE INDEX ux_packs_barcode_value ON packs (barcode_value);
CREATE INDEX ix_packs_name ON packs (name);
CREATE INDEX ix_packs_status ON packs (status);

CREATE TABLE pack_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id  INTEGER NOT NULL REFERENCES packs (id),
  item_id  INTEGER NOT NULL REFERENCES items (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE UNIQUE INDEX ux_pack_items_pack_item ON pack_items (pack_id, item_id);
CREATE INDEX ix_pack_items_item ON pack_items (item_id);

-- ---------------------------------------------------------------------------
-- Operation (§17.4)
-- Таблица НЕ содержит и не может содержать patient_id, Symplast Patient Code,
-- ФИО, дату рождения, телефон, номер карты (§2.4, §18.3). Таблицы сопоставления
-- операции с пациентом в схеме нет и быть не должно (§7.3).
-- ---------------------------------------------------------------------------

CREATE TABLE operations (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  random_case_code          TEXT    NOT NULL,
  status                    TEXT    NOT NULL CHECK (status IN ('Active', 'Finished', 'Voided')),
  procedure_category        TEXT,
  total_cost_snapshot_cents INTEGER,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL,
  finished_at               INTEGER,
  voided_at                 INTEGER,
  void_reason               TEXT,
  created_by_account_id     INTEGER REFERENCES user_accounts (id),
  finished_by_account_id    INTEGER REFERENCES user_accounts (id),
  voided_by_account_id      INTEGER REFERENCES user_accounts (id),
  CHECK (status <> 'Finished' OR finished_at IS NOT NULL),
  CHECK (status <> 'Voided'   OR voided_at   IS NOT NULL),
  CHECK (status <> 'Active'   OR (finished_at IS NULL AND voided_at IS NULL))
);
CREATE UNIQUE INDEX ux_operations_case_code ON operations (random_case_code);
CREATE INDEX ix_operations_status_created ON operations (status, created_at DESC);
CREATE INDEX ix_operations_created ON operations (created_at DESC);
CREATE INDEX ix_operations_category ON operations (procedure_category);

-- ---------------------------------------------------------------------------
-- OperationItem (§17.5) — строка со снимками (§11.2)
-- ---------------------------------------------------------------------------

CREATE TABLE operation_items (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id                 INTEGER NOT NULL REFERENCES operations (id),
  item_id                      INTEGER NOT NULL REFERENCES items (id),
  source_type                  TEXT    NOT NULL CHECK (source_type IN ('individual', 'pack')),
  source_pack_id               INTEGER REFERENCES packs (id),
  item_name_snapshot           TEXT    NOT NULL,
  internal_code_snapshot       TEXT    NOT NULL,
  sku_snapshot                 TEXT,
  reference_number_snapshot    TEXT,
  unit_of_measurement_snapshot TEXT    NOT NULL,
  quantity                     INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_snapshot_cents     INTEGER NOT NULL CHECK (unit_cost_snapshot_cents >= 0),
  line_total_cents             INTEGER NOT NULL,
  created_at                   INTEGER NOT NULL,
  updated_at                   INTEGER NOT NULL,
  -- §11.2: line total = quantity × unit cost snapshot. Инвариант держит БД.
  CHECK (line_total_cents = quantity * unit_cost_snapshot_cents),
  CHECK (
    (source_type = 'pack'       AND source_pack_id IS NOT NULL) OR
    (source_type = 'individual' AND source_pack_id IS NULL)
  )
);
-- Ключ агрегации строк (Q-15 + docs/decisions.md D-5).
-- COALESCE нужен потому, что в SQLite NULL-значения в UNIQUE-индексе считаются
-- различными, и без него две строки с source_pack_id IS NULL прошли бы проверку.
CREATE UNIQUE INDEX ux_operation_items_agg
  ON operation_items (operation_id, item_id, source_type, COALESCE(source_pack_id, 0), unit_cost_snapshot_cents);
CREATE INDEX ix_operation_items_operation ON operation_items (operation_id);
CREATE INDEX ix_operation_items_item ON operation_items (item_id);
CREATE INDEX ix_operation_items_pack ON operation_items (source_pack_id);

-- ---------------------------------------------------------------------------
-- OperationEvent — журнал действий активной операции (§7.6, Q-27)
-- Нужен для Undo Last Scan: он должен откатывать скан пака целиком, а не
-- одну позицию, иначе §16 нарушается «в обратную сторону».
-- ---------------------------------------------------------------------------

CREATE TABLE operation_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id    INTEGER NOT NULL REFERENCES operations (id),
  event_type      TEXT    NOT NULL CHECK (event_type IN (
                    'item_added', 'pack_added', 'quantity_changed',
                    'line_removed', 'undo', 'category_changed',
                    'finished', 'voided')),
  client_event_id TEXT    NOT NULL,
  payload_json    TEXT    NOT NULL DEFAULT '{}',
  undoable        INTEGER NOT NULL DEFAULT 0 CHECK (undoable IN (0, 1)),
  undone_at       INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_operation_events_client ON operation_events (operation_id, client_event_id);
CREATE INDEX ix_operation_events_operation ON operation_events (operation_id, id DESC);

-- ---------------------------------------------------------------------------
-- Инвентаризация (§5.10, C-4, Q-17) — черновик обязан переживать refresh,
-- значит хранится на сервере, а не в памяти страницы.
-- ---------------------------------------------------------------------------

CREATE TABLE inventory_counts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  status                TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'cancelled')),
  notes                 TEXT,
  created_by_account_id INTEGER REFERENCES user_accounts (id),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  applied_at            INTEGER,
  cancelled_at          INTEGER,
  CHECK (status <> 'applied'   OR applied_at   IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
CREATE INDEX ix_inventory_counts_status ON inventory_counts (status, created_at DESC);

CREATE TABLE inventory_count_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id          INTEGER NOT NULL REFERENCES inventory_counts (id),
  item_id           INTEGER NOT NULL REFERENCES items (id),
  -- Снимок ожидаемого на момент ввода строки: параллельно идущая операция
  -- иначе исказит расчёт разницы (docs/state-machines.md §3.1).
  expected_quantity INTEGER NOT NULL,
  counted_quantity  INTEGER NOT NULL,
  difference        INTEGER NOT NULL,
  applied           INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  CHECK (difference = counted_quantity - expected_quantity)
);
CREATE UNIQUE INDEX ux_inventory_count_lines ON inventory_count_lines (count_id, item_id);
CREATE INDEX ix_inventory_count_lines_item ON inventory_count_lines (item_id);

-- ---------------------------------------------------------------------------
-- InventoryMovement (§17.6) — единственный способ изменить остаток (§10.4)
-- ---------------------------------------------------------------------------

CREATE TABLE inventory_movements (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id                    INTEGER NOT NULL REFERENCES items (id),
  movement_type              TEXT    NOT NULL CHECK (movement_type IN (
                               'initial',
                               'received',
                               'used_in_operation',
                               'returned_from_operation',
                               'manual_adjustment',
                               'count_correction',
                               'void_reversal')),
  quantity_delta             INTEGER NOT NULL CHECK (quantity_delta <> 0),
  operation_id               INTEGER REFERENCES operations (id),
  inventory_count_id         INTEGER REFERENCES inventory_counts (id),
  reason                     TEXT,
  -- Q-9: цену конкретной поставки задним числом не восстановить, поэтому она
  -- сохраняется уже сейчас, хотя FIFO/средневзвешенная отнесены в V2 (§20).
  unit_cost_at_receipt_cents INTEGER,
  -- §10.4/§16: единственная надёжная защита от двойного списания. Ключ приходит
  -- от клиента и проверяется уникальным индексом БД, а не памятью приложения.
  idempotency_key            TEXT    NOT NULL,
  created_by_account_id      INTEGER REFERENCES user_accounts (id),
  created_at                 INTEGER NOT NULL,
  CHECK (movement_type NOT IN ('used_in_operation', 'returned_from_operation', 'void_reversal')
         OR operation_id IS NOT NULL),
  CHECK (movement_type <> 'manual_adjustment' OR (reason IS NOT NULL AND length(trim(reason)) > 0)),
  CHECK (movement_type <> 'count_correction'  OR inventory_count_id IS NOT NULL),
  CHECK (movement_type NOT IN ('initial', 'received', 'void_reversal', 'returned_from_operation')
         OR quantity_delta > 0),
  CHECK (movement_type <> 'used_in_operation' OR quantity_delta < 0)
);
CREATE UNIQUE INDEX ux_inventory_movements_idempotency ON inventory_movements (idempotency_key);
CREATE INDEX ix_inventory_movements_item_created ON inventory_movements (item_id, created_at);
CREATE INDEX ix_inventory_movements_operation ON inventory_movements (operation_id);
CREATE INDEX ix_inventory_movements_op_item_type ON inventory_movements (operation_id, item_id, movement_type);
CREATE INDEX ix_inventory_movements_type_created ON inventory_movements (movement_type, created_at);

-- ---------------------------------------------------------------------------
-- SystemSetting (§3.2, §7.10, Q-16)
-- ---------------------------------------------------------------------------

CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO system_settings (key, value, updated_at) VALUES
  -- §3.2: «По умолчанию во время операции Staff ... не обязан видеть стоимость».
  ('staff_can_see_cost',         'false',           CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  -- §7.10: «рекомендуемый режим — разрешить сканирование с ярким предупреждением».
  ('negative_stock_mode',        'warn',            CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('procedure_category_enabled', 'true',            CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('sound_on_scan_enabled',      'true',            CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('label_size_preset',          '50x25mm',         CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('large_quantity_warn_at',     '100',             CAST(strftime('%s', 'now') AS INTEGER) * 1000);

-- ---------------------------------------------------------------------------
-- AuditLog (§15, C-14, Q-18). Пациентских данных не содержит.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_account_id INTEGER REFERENCES user_accounts (id),
  actor_role       TEXT,
  action           TEXT    NOT NULL,
  entity_type      TEXT,
  entity_id        INTEGER,
  summary          TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX ix_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX ix_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX ix_audit_log_action ON audit_log (action, created_at DESC);
