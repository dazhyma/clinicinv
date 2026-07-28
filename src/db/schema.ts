/**
 * Типизированное отражение схемы БД для Drizzle ORM.
 *
 * ИСТОЧНИК ИСТИНЫ ДЛЯ DDL — файлы `drizzle/*.sql`. Здесь описаны те же таблицы
 * для типобезопасных запросов; CHECK-констрейнты и выражения в индексах
 * (COALESCE в ux_operation_items_agg) выражаются только в SQL.
 * Соответствие столбцов проверяется тестом tests/schema.test.ts.
 *
 * Деньги — целые центы. Количества — целые числа. Время — unix-мс UTC.
 */
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// --- Справочные типы --------------------------------------------------------

export const USER_ROLES = ['Staff', 'Admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const OPERATION_STATUSES = ['Active', 'Finished', 'Voided'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export const ENTITY_STATUSES = ['active', 'inactive'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

/**
 * §10.4 перечисляет шесть типов движений. Седьмой — `initial` — введён
 * осознанно: §5.4 делает Initial Quantity обязательным полем, а прямая запись
 * начального количества в items.current_quantity мимо журнала сломала бы
 * инвариант current_quantity == SUM(quantity_delta) на первом же предмете
 * (противоречие C-13). См. docs/decisions.md D-4.
 */
export const MOVEMENT_TYPES = [
  'initial',
  'received',
  'used_in_operation',
  'returned_from_operation',
  'manual_adjustment',
  'count_correction',
  'void_reversal',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const SOURCE_TYPES = ['individual', 'pack'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ADJUSTMENT_REASONS = [
  'damaged',
  'expired',
  'missing',
  'inventory correction',
  'received outside normal process',
  'other',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** §5.4. Список расширяемый через настройки, поэтому это не enum на уровне БД (Q-24). */
export const DEFAULT_UNITS_OF_MEASUREMENT = [
  'each',
  'box',
  'pack',
  'pair',
  'mL',
  'bottle',
  'roll',
] as const;

// --- Учётные записи, сессии, попытки входа ---------------------------------

export const userAccounts = sqliteTable(
  'user_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    /** Только argon2id-хеш. Пароль в открытом виде не хранится нигде (§3.1, §15). */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('ux_user_accounts_username').on(t.username)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** SHA-256 от токена. Сам токен живёт только в httpOnly cookie. */
    tokenHash: text('token_hash').notNull(),
    accountId: integer('account_id')
      .notNull()
      .references(() => userAccounts.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('ux_sessions_token_hash').on(t.tokenHash),
    index('ix_sessions_account').on(t.accountId),
    index('ix_sessions_expires').on(t.expiresAt),
  ],
);

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    ip: text('ip').notNull(),
    failedCount: integer('failed_count').notNull().default(0),
    firstFailedAt: integer('first_failed_at', { mode: 'timestamp_ms' }),
    lastFailedAt: integer('last_failed_at', { mode: 'timestamp_ms' }),
    lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('ux_login_attempts_username_ip').on(t.username, t.ip)],
);

// --- Коды и штрихкоды -------------------------------------------------------

export const codeSequences = sqliteTable('code_sequences', {
  prefix: text('prefix').primaryKey(),
  nextValue: integer('next_value').notNull(),
});

export const barcodeRegistry = sqliteTable(
  'barcode_registry',
  {
    barcodeValue: text('barcode_value').primaryKey(),
    ownerType: text('owner_type', { enum: ['item', 'pack'] }).notNull(),
    ownerId: integer('owner_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('ix_barcode_registry_owner').on(t.ownerType, t.ownerId)],
);

// --- Item (§17.1) -----------------------------------------------------------

export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `ITM-000127`. Постоянен, не переиспользуется, не редактируется формой (§5.5, §18.7). */
    internalCode: text('internal_code').notNull(),
    /** SKU, если он задан; иначе internalCode. Глобальная уникальность — в barcodeRegistry. */
    barcodeValue: text('barcode_value').notNull(),
    name: text('name').notNull(),
    photoUrl: text('photo_url'),
    sku: text('sku'),
    referenceNumber: text('reference_number'),
    /** Cost, не продажная цена (§11.1). Целые центы. */
    currentUnitCostCents: integer('current_unit_cost_cents').notNull(),
    unitOfMeasurement: text('unit_of_measurement').notNull(),
    /** Инвариант: == SUM(inventory_movements.quantity_delta) по этому предмету. */
    currentQuantity: integer('current_quantity').notNull().default(0),
    category: text('category'),
    storageLocation: text('storage_location'),
    lowStockThreshold: integer('low_stock_threshold'),
    notes: text('notes'),
    status: text('status', { enum: ENTITY_STATUSES }).notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('ux_items_internal_code').on(t.internalCode),
    uniqueIndex('ux_items_barcode_value').on(t.barcodeValue),
    index('ix_items_sku').on(t.sku),
    index('ix_items_reference_number').on(t.referenceNumber),
    index('ix_items_name').on(t.name),
    index('ix_items_category').on(t.category),
    index('ix_items_storage_location').on(t.storageLocation),
    index('ix_items_status').on(t.status),
    index('ix_items_current_quantity').on(t.currentQuantity),
  ],
);

// --- Pack / PackItem (§17.2, §17.3) ----------------------------------------

export const packs = sqliteTable(
  'packs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `PCK-000015` (§6.3, §18.6). */
    internalCode: text('internal_code').notNull(),
    barcodeValue: text('barcode_value').notNull(),
    name: text('name').notNull(),
    photoUrl: text('photo_url'),
    notes: text('notes'),
    status: text('status', { enum: ENTITY_STATUSES }).notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    // Полей current_quantity и стоимости здесь нет и быть не должно:
    // пак не является физическим складским объектом (§6.5, §18.10),
    // а его стоимость всегда вычисляется по текущим ценам предметов (§6.4).
  },
  (t) => [
    uniqueIndex('ux_packs_internal_code').on(t.internalCode),
    uniqueIndex('ux_packs_barcode_value').on(t.barcodeValue),
    index('ix_packs_name').on(t.name),
    index('ix_packs_status').on(t.status),
  ],
);

export const packItems = sqliteTable(
  'pack_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    packId: integer('pack_id')
      .notNull()
      .references(() => packs.id),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    uniqueIndex('ux_pack_items_pack_item').on(t.packId, t.itemId),
    index('ix_pack_items_item').on(t.itemId),
  ],
);

// --- Operation (§17.4) ------------------------------------------------------

export const operations = sqliteTable(
  'operations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Случайный код записи. НЕ идентификатор пациента (§7.3, §18.4). */
    randomCaseCode: text('random_case_code').notNull(),
    status: text('status', { enum: OPERATION_STATUSES }).notNull(),
    /** Только значение из закрытого справочника обобщённых категорий (§2.4, Q-2). */
    procedureCategory: text('procedure_category'),
    /** Фиксируется в момент Finish and Lock (§11.5). Целые центы. */
    totalCostSnapshotCents: integer('total_cost_snapshot_cents'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    voidReason: text('void_reason'),
    createdByAccountId: integer('created_by_account_id').references(() => userAccounts.id),
    finishedByAccountId: integer('finished_by_account_id').references(() => userAccounts.id),
    voidedByAccountId: integer('voided_by_account_id').references(() => userAccounts.id),
  },
  (t) => [
    uniqueIndex('ux_operations_case_code').on(t.randomCaseCode),
    index('ix_operations_status_created').on(t.status, t.createdAt),
    index('ix_operations_created').on(t.createdAt),
    index('ix_operations_category').on(t.procedureCategory),
  ],
);

// --- OperationItem (§17.5) --------------------------------------------------

export const operationItems = sqliteTable(
  'operation_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id),
    /** Только для внутренней связи. Отображается всегда снимок, не текущее значение. */
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id),
    sourceType: text('source_type', { enum: SOURCE_TYPES }).notNull(),
    sourcePackId: integer('source_pack_id').references(() => packs.id),
    itemNameSnapshot: text('item_name_snapshot').notNull(),
    internalCodeSnapshot: text('internal_code_snapshot').notNull(),
    skuSnapshot: text('sku_snapshot'),
    referenceNumberSnapshot: text('reference_number_snapshot'),
    unitOfMeasurementSnapshot: text('unit_of_measurement_snapshot').notNull(),
    quantity: integer('quantity').notNull(),
    /** Стоимость единицы на момент добавления. Никогда не пересчитывается (§18.15). */
    unitCostSnapshotCents: integer('unit_cost_snapshot_cents').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    // Фактический уникальный индекс использует COALESCE(source_pack_id, 0)
    // и объявлен в drizzle/0001_init.sql — см. комментарий в шапке файла.
    index('ix_operation_items_operation').on(t.operationId),
    index('ix_operation_items_item').on(t.itemId),
    index('ix_operation_items_pack').on(t.sourcePackId),
  ],
);

// --- OperationEvent (§7.6, Q-27) -------------------------------------------

export const OPERATION_EVENT_TYPES = [
  'item_added',
  'pack_added',
  'quantity_changed',
  'line_removed',
  'undo',
  'category_changed',
  'finished',
  'voided',
] as const;
export type OperationEventType = (typeof OPERATION_EVENT_TYPES)[number];

export const operationEvents = sqliteTable(
  'operation_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id),
    eventType: text('event_type', { enum: OPERATION_EVENT_TYPES }).notNull(),
    clientEventId: text('client_event_id').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    undoable: integer('undoable', { mode: 'boolean' }).notNull().default(false),
    undoneAt: integer('undone_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('ux_operation_events_client').on(t.operationId, t.clientEventId),
    index('ix_operation_events_operation').on(t.operationId, t.id),
  ],
);

// --- Инвентаризация (§5.10) -------------------------------------------------

export const INVENTORY_COUNT_STATUSES = ['draft', 'applied', 'cancelled'] as const;
export type InventoryCountStatus = (typeof INVENTORY_COUNT_STATUSES)[number];

export const inventoryCounts = sqliteTable(
  'inventory_counts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Публичный внутренний номер вида INV-000017. */
    internalCode: text('internal_code'),
    status: text('status', { enum: INVENTORY_COUNT_STATUSES }).notNull().default('draft'),
    notes: text('notes'),
    createdByAccountId: integer('created_by_account_id').references(() => userAccounts.id),
    createdByRole: text('created_by_role', { enum: USER_ROLES }),
    completedByAccountId: integer('completed_by_account_id').references(() => userAccounts.id),
    completedByRole: text('completed_by_role', { enum: USER_ROLES }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    appliedAt: integer('applied_at', { mode: 'timestamp_ms' }),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('ux_inventory_counts_internal_code').on(t.internalCode),
    uniqueIndex('ux_inventory_counts_single_draft')
      .on(t.status)
      .where(sql`${t.status} = 'draft'`),
    index('ix_inventory_counts_status').on(t.status, t.createdAt),
    index('ix_inventory_counts_applied_at').on(t.status, t.appliedAt),
  ],
);

export const inventoryCountLines = sqliteTable(
  'inventory_count_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    countId: integer('count_id')
      .notNull()
      .references(() => inventoryCounts.id),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id),
    expectedQuantity: integer('expected_quantity').notNull(),
    countedQuantity: integer('counted_quantity').notNull(),
    difference: integer('difference').notNull(),
    applied: integer('applied', { mode: 'boolean' }).notNull().default(false),
    itemNameSnapshot: text('item_name_snapshot'),
    internalCodeSnapshot: text('internal_code_snapshot'),
    skuSnapshot: text('sku_snapshot'),
    referenceNumberSnapshot: text('reference_number_snapshot'),
    photoUrlSnapshot: text('photo_url_snapshot'),
    unitOfMeasurementSnapshot: text('unit_of_measurement_snapshot'),
    finalQuantity: integer('final_quantity'),
    updatedByAccountId: integer('updated_by_account_id').references(() => userAccounts.id),
    updatedByRole: text('updated_by_role', { enum: USER_ROLES }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('ux_inventory_count_lines').on(t.countId, t.itemId),
    index('ix_inventory_count_lines_item').on(t.itemId),
  ],
);

// --- InventoryMovement (§17.6) ---------------------------------------------

export const inventoryMovements = sqliteTable(
  'inventory_movements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id),
    movementType: text('movement_type', { enum: MOVEMENT_TYPES }).notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    operationId: integer('operation_id').references(() => operations.id),
    inventoryCountId: integer('inventory_count_id').references(() => inventoryCounts.id),
    reason: text('reason'),
    unitCostAtReceiptCents: integer('unit_cost_at_receipt_cents'),
    /** Приходит от клиента. UNIQUE на уровне БД — единственная защита от гонки. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdByAccountId: integer('created_by_account_id').references(() => userAccounts.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('ux_inventory_movements_idempotency').on(t.idempotencyKey),
    index('ix_inventory_movements_item_created').on(t.itemId, t.createdAt),
    index('ix_inventory_movements_operation').on(t.operationId),
    index('ix_inventory_movements_op_item_type').on(t.operationId, t.itemId, t.movementType),
    index('ix_inventory_movements_type_created').on(t.movementType, t.createdAt),
  ],
);

// --- SystemSetting / AuditLog ----------------------------------------------

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorAccountId: integer('actor_account_id').references(() => userAccounts.id),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: integer('entity_id'),
    /** Краткая сводка без пациентских данных (§15, §18.3). */
    summary: text('summary'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('ix_audit_log_created').on(t.createdAt),
    index('ix_audit_log_entity').on(t.entityType, t.entityId),
    index('ix_audit_log_action').on(t.action, t.createdAt),
  ],
);

// --- Структурированная история изменений Item -------------------------------

export const itemHistoryEvents = sqliteTable(
  'item_history_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id),
    eventType: text('event_type').notNull(),
    fieldName: text('field_name'),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    actorAccountId: integer('actor_account_id').references(() => userAccounts.id),
    actorRole: text('actor_role', { enum: USER_ROLES }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('ix_item_history_events_item_created').on(t.itemId, t.createdAt),
    index('ix_item_history_events_type_created').on(t.eventType, t.createdAt),
  ],
);

/** Полный набор таблиц — используется в tests/schema.test.ts для сверки с БД. */
export const allTables = {
  userAccounts,
  sessions,
  loginAttempts,
  codeSequences,
  barcodeRegistry,
  items,
  packs,
  packItems,
  operations,
  operationItems,
  operationEvents,
  inventoryCounts,
  inventoryCountLines,
  inventoryMovements,
  systemSettings,
  auditLog,
  itemHistoryEvents,
};

export const NOW = sql`(CAST(strftime('%s', 'now') AS INTEGER) * 1000)`;

export type ItemRow = typeof items.$inferSelect;
export type PackRow = typeof packs.$inferSelect;
export type PackItemRow = typeof packItems.$inferSelect;
export type OperationRow = typeof operations.$inferSelect;
export type OperationItemRow = typeof operationItems.$inferSelect;
export type InventoryMovementRow = typeof inventoryMovements.$inferSelect;
export type UserAccountRow = typeof userAccounts.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type InventoryCountRow = typeof inventoryCounts.$inferSelect;
export type InventoryCountLineRow = typeof inventoryCountLines.$inferSelect;
export type ItemHistoryEventRow = typeof itemHistoryEvents.$inferSelect;
export type OperationEventRow = typeof operationEvents.$inferSelect;
