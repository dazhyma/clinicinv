/**
 * Операции: жизненный цикл Active → Finished → Voided (§7, §8, §9, §10, §11).
 *
 * Ключевые правила, реализованные здесь:
 *  - каждое действие сохраняется на сервере немедленно, в своей транзакции (§8.1);
 *  - автозавершение по таймеру отсутствует как код: статус меняют только
 *    finishOperation() и voidOperation(), вызванные пользователем (§9.1, §18.13);
 *  - несколько активных операций сосуществуют, новая никогда не перезаписывает
 *    существующую (§8.5, §18.24) — операции просто независимые строки;
 *  - при добавлении предмета в строку копируются снимки (§11.2, §18.15);
 *  - изменение текущей цены НИКОГДА не пересчитывает ни завершённые операции,
 *    ни уже добавленные строки активной (§11.3, §11.4, §18.16);
 *  - Void создаёт обратные движения ровно на чистое списание этой операции,
 *    а не восстанавливает старый общий остаток (§10.3, §18.20);
 *  - повторный Void невозможен (§18.21).
 *
 * Приватность: ни здесь, ни в схеме нет и не может быть полей пациента.
 * `random_case_code` — случайная строка, не производная от каких-либо данных
 * (§2.4, §7.3, §18.3, §18.4).
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { AppDatabase, DbLike, Tx } from '@/db/client';
import {
  items,
  operationEvents,
  operationItems,
  operations,
  packs,
  type ItemRow,
  type OperationItemRow,
  type OperationRow,
  type OperationStatus,
  type PackRow,
  type SourceType,
} from '@/db/schema';
import { assertAdmin, assertAuthenticated, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import { findBarcodeOwner, generateCaseCode, normalizeScannedCode } from './codes';
import { errors } from './errors';
import { formatCents, lineTotalCents } from './money';
import {
  applyMovement,
  idempotencyKeys,
  netDeductionsByOperation,
  runInTransaction,
} from './movements';
import { getPackComposition, type PackComponent } from './packs';
import { assertNonNegativeQuantity, assertPositiveQuantity } from './quantity';
import { getIntSetting, getNegativeStockMode, SETTING_KEYS } from './settings';

// --- Типы результатов -------------------------------------------------------

export interface OperationWarning {
  code: 'NEGATIVE_STOCK' | 'LARGE_QUANTITY';
  message: string;
  itemId?: number;
}

export interface AddToOperationResult {
  lines: OperationItemRow[];
  /** false — событие с этим clientEventId уже применялось; повтора не было. */
  applied: boolean;
  warnings: OperationWarning[];
  /** Остатки затронутых предметов после операции. */
  stockAfter: { itemId: number; quantity: number }[];
}

interface UndoPayloadLine {
  operationItemId: number;
  itemId: number;
  quantity: number;
}

// --- Вспомогательное --------------------------------------------------------

export function getOperation(tx: DbLike, operationId: number): OperationRow | undefined {
  return tx.select().from(operations).where(eq(operations.id, operationId)).get();
}

export function findOperationByCaseCode(tx: DbLike, code: string): OperationRow | undefined {
  return tx
    .select()
    .from(operations)
    .where(eq(operations.randomCaseCode, code.trim().toUpperCase()))
    .get();
}

export function listOperationLines(tx: DbLike, operationId: number): OperationItemRow[] {
  return tx
    .select()
    .from(operationItems)
    .where(eq(operationItems.operationId, operationId))
    .orderBy(operationItems.id)
    .all();
}

/** §11.5: итог активной операции = сумма line_total её строк. */
export function calculateOperationTotalCents(tx: DbLike, operationId: number): number {
  const row = tx
    .select({ total: sql<number>`coalesce(sum(${operationItems.lineTotalCents}), 0)` })
    .from(operationItems)
    .where(eq(operationItems.operationId, operationId))
    .get();
  return row?.total ?? 0;
}

/**
 * Итог для отображения: у завершённой и аннулированной операции — зафиксированный
 * снимок, у активной — текущая сумма строк. Джойн к текущей цене предмета
 * запрещён категорически (§11.3, §18.16).
 */
export function operationTotalCents(tx: DbLike, operation: OperationRow): number {
  if (operation.status === 'Active') return calculateOperationTotalCents(tx, operation.id);
  return operation.totalCostSnapshotCents ?? calculateOperationTotalCents(tx, operation.id);
}

function loadActiveOperation(tx: DbLike, operationId: number): OperationRow {
  const operation = getOperation(tx, operationId);
  if (!operation) throw errors.operationNotFound(operationId);
  if (operation.status === 'Voided') throw errors.operationAlreadyVoided();
  if (operation.status === 'Finished') throw errors.operationAlreadyFinished();
  return operation;
}

function touchOperation(tx: DbLike, operationId: number): void {
  tx.update(operations).set({ updatedAt: new Date() }).where(eq(operations.id, operationId)).run();
}

function findEventByClientId(
  tx: DbLike,
  operationId: number,
  clientEventId: string,
): { id: number } | undefined {
  return tx
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.operationId, operationId),
        eq(operationEvents.clientEventId, clientEventId),
      ),
    )
    .get();
}

/**
 * §7.10: при нехватке остатка система обязана предупредить, но не обязана
 * блокировать. Режим настраивается Admin; по умолчанию `warn`, потому что ТЗ
 * прямо пишет, что блокировка в условиях операции может быть опасно неудобной.
 */
function checkStock(
  tx: DbLike,
  item: ItemRow,
  requested: number,
  warnings: OperationWarning[],
): void {
  if (item.currentQuantity >= requested) return;
  if (getNegativeStockMode(tx) === 'block') {
    throw errors.insufficientStock(item.currentQuantity, item.name);
  }
  warnings.push({
    code: 'NEGATIVE_STOCK',
    itemId: item.id,
    message: `Only ${item.currentQuantity} ${item.currentQuantity === 1 ? 'unit' : 'units'} remain in inventory`,
  });
}

/**
 * Создаёт или наращивает строку операции.
 *
 * Ключ агрегации — (operation_id, item_id, source_type, source_pack_id,
 * unit_cost_snapshot_cents). Цена входит в ключ намеренно (docs/decisions.md D-5):
 *  - повторный скан при неизменной цене наращивает ту же строку (§7.6);
 *  - если Admin изменил цену, создаётся ОТДЕЛЬНАЯ строка по новой цене, а
 *    старая остаётся нетронутой — иначе пришлось бы либо переписать снимок
 *    (нарушение §18.15), либо применить старую цену к новому добавлению
 *    (нарушение §11.4).
 */
function upsertOperationLine(
  tx: DbLike,
  operationId: number,
  item: ItemRow,
  quantity: number,
  sourceType: SourceType,
  sourcePackId: number | null,
): OperationItemRow {
  const now = new Date();
  const existing = tx
    .select()
    .from(operationItems)
    .where(
      and(
        eq(operationItems.operationId, operationId),
        eq(operationItems.itemId, item.id),
        eq(operationItems.sourceType, sourceType),
        sourcePackId === null
          ? isNull(operationItems.sourcePackId)
          : eq(operationItems.sourcePackId, sourcePackId),
        eq(operationItems.unitCostSnapshotCents, item.currentUnitCostCents),
      ),
    )
    .get();

  if (existing) {
    const nextQuantity = existing.quantity + quantity;
    return tx
      .update(operationItems)
      .set({
        quantity: nextQuantity,
        lineTotalCents: lineTotalCents(nextQuantity, existing.unitCostSnapshotCents),
        updatedAt: now,
      })
      .where(eq(operationItems.id, existing.id))
      .returning()
      .get();
  }

  // Новое дополнение к ТЗ: снимки имени, Item Code, reference number и стоимости
  // единицы копируются в строку в момент добавления и больше не меняются.
  return tx
    .insert(operationItems)
    .values({
      operationId,
      itemId: item.id,
      sourceType,
      sourcePackId,
      itemNameSnapshot: item.name,
      internalCodeSnapshot: item.internalCode,
      referenceNumberSnapshot: item.referenceNumber,
      unitOfMeasurementSnapshot: item.unitOfMeasurement,
      quantity,
      unitCostSnapshotCents: item.currentUnitCostCents,
      lineTotalCents: lineTotalCents(quantity, item.currentUnitCostCents),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

function warnOnLargeQuantity(
  tx: DbLike,
  line: OperationItemRow,
  warnings: OperationWarning[],
): void {
  // Q-32: защита от «залипшего» сканера. Мягкая — жёсткий запрет в операционной опасен.
  const threshold = getIntSetting(tx, SETTING_KEYS.largeQuantityWarnAt, 100);
  if (line.quantity > threshold) {
    warnings.push({
      code: 'LARGE_QUANTITY',
      itemId: line.itemId,
      message: `${line.quantity} units of ${line.itemNameSnapshot} in one operation — please confirm this is correct`,
    });
  }
}

function loadItemForScan(tx: DbLike, itemId: number): ItemRow {
  const item = tx.select().from(items).where(eq(items.id, itemId)).get();
  if (!item) throw errors.itemNotFound(itemId);
  // Q-28: скан неактивного предмета отклоняется (§14.4 «Item is inactive»).
  if (item.status !== 'active') throw errors.itemInactive(item.name);
  return item;
}

function replayResult(tx: DbLike, operationId: number, itemIds: number[]): AddToOperationResult {
  const lines = listOperationLines(tx, operationId).filter((line) => itemIds.includes(line.itemId));
  return {
    lines,
    applied: false,
    warnings: [],
    stockAfter: itemIds.map((itemId) => ({
      itemId,
      quantity:
        tx.select({ q: items.currentQuantity }).from(items).where(eq(items.id, itemId)).get()?.q ??
        0,
    })),
  };
}

// --- T1: создание операции --------------------------------------------------

export interface StartOperationInput {
  /** Только значение из закрытого справочника обобщённых категорий (§2.4, Q-2). */
  procedureCategory?: string | null;
}

/**
 * Start New Operation (§7.3, T1).
 * Запись сохраняется на сервере СРАЗУ, до первого скана (§8.1, AC-2.1 шаг 1).
 */
export function startOperation(
  db: AppDatabase,
  actor: Actor,
  input: StartOperationInput = {},
): OperationRow {
  assertAuthenticated(actor);

  return runInTransaction(db, (tx) => {
    const now = new Date();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCaseCode();
      const clash = tx
        .select({ id: operations.id })
        .from(operations)
        .where(eq(operations.randomCaseCode, code))
        .get();
      if (clash) continue;

      const created = tx
        .insert(operations)
        .values({
          randomCaseCode: code,
          status: 'Active',
          procedureCategory: input.procedureCategory?.trim() || null,
          totalCostSnapshotCents: null,
          createdAt: now,
          updatedAt: now,
          createdByAccountId: actor.accountId,
        })
        .returning()
        .get();

      writeAudit(tx, {
        action: AUDIT_ACTIONS.operationStarted,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'operation',
        entityId: created.id,
        summary: `Case ${code}`,
      });

      return created;
    }
    throw errors.codeGenerationFailed();
  });
}

// --- Добавление отдельного предмета ----------------------------------------

export interface AddItemToOperationInput {
  operationId: number;
  itemId: number;
  /** Скан всегда даёт 1; ручное добавление может дать больше. */
  quantity?: number;
  /**
   * Идентификатор события, СГЕНЕРИРОВАННЫЙ КЛИЕНТОМ в момент скана и
   * неизменный при ретраях. Ключ, сгенерированный сервером, идемпотентности
   * не даёт (docs/state-machines.md §2.7).
   */
  clientEventId: string;
  sourceType?: SourceType;
  sourcePackId?: number | null;
}

/** §7.5, §7.8, §10.1: скан предмета либо добавление через ручной поиск. */
export function addItemToOperation(
  db: AppDatabase,
  actor: Actor,
  input: AddItemToOperationInput,
): AddToOperationResult {
  assertAuthenticated(actor);
  const quantity = assertPositiveQuantity(input.quantity ?? 1, 'Quantity');
  if (!input.clientEventId?.trim()) {
    throw errors.validationFailed('A client event id is required for every scan');
  }

  return runInTransaction(db, (tx) => {
    const operation = loadActiveOperation(tx, input.operationId);

    if (findEventByClientId(tx, operation.id, input.clientEventId)) {
      return replayResult(tx, operation.id, [input.itemId]);
    }

    const item = loadItemForScan(tx, input.itemId);
    const warnings: OperationWarning[] = [];
    checkStock(tx, item, quantity, warnings);

    const movement = applyMovement(tx, {
      itemId: item.id,
      movementType: 'used_in_operation',
      quantityDelta: -quantity,
      operationId: operation.id,
      idempotencyKey: idempotencyKeys.operationScan(operation.id, input.clientEventId),
      actorAccountId: actor.accountId,
    });

    if (!movement.created) return replayResult(tx, operation.id, [item.id]);

    const line = upsertOperationLine(
      tx,
      operation.id,
      item,
      quantity,
      input.sourceType ?? 'individual',
      input.sourcePackId ?? null,
    );
    warnOnLargeQuantity(tx, line, warnings);

    const payload: { lines: UndoPayloadLine[] } = {
      lines: [{ operationItemId: line.id, itemId: item.id, quantity }],
    };
    tx.insert(operationEvents)
      .values({
        operationId: operation.id,
        eventType: 'item_added',
        clientEventId: input.clientEventId,
        payloadJson: JSON.stringify(payload),
        undoable: true,
        createdAt: new Date(),
      })
      .run();

    touchOperation(tx, operation.id);

    return {
      lines: [line],
      applied: true,
      warnings,
      stockAfter: [{ itemId: item.id, quantity: movement.quantityAfter }],
    };
  });
}

// --- Сканирование пака ------------------------------------------------------

export interface AddPackToOperationInput {
  operationId: number;
  packId: number;
  clientEventId: string;
}

/**
 * §7.7 / §16 / AC-3.2: один скан пака добавляет ВЕСЬ состав.
 *
 * Атомарность обеспечивается единственной транзакцией на весь пак: либо
 * добавляются все позиции и списываются все остатки, либо не меняется ничего
 * и пользователь получает понятную ошибку. «Половина пака» невозможна.
 */
export function addPackToOperation(
  db: AppDatabase,
  actor: Actor,
  input: AddPackToOperationInput,
): AddToOperationResult {
  assertAuthenticated(actor);
  if (!input.clientEventId?.trim()) {
    throw errors.validationFailed('A client event id is required for every scan');
  }

  return runInTransaction(db, (tx) => {
    const operation = loadActiveOperation(tx, input.operationId);

    const pack = tx.select().from(packs).where(eq(packs.id, input.packId)).get();
    if (!pack) throw errors.packNotFound(input.packId);
    if (pack.status !== 'active') throw errors.packInactive(pack.name);

    // Состав читается СЕЙЧАС: последующее изменение пака на эту операцию
    // уже не повлияет, а прошлые операции не меняются никогда (§6.7, §18.17).
    const composition = getPackComposition(tx, pack.id);
    if (!composition.length) throw errors.packEmpty(pack.name);

    const itemIds = composition.map((component) => component.item.id);
    if (findEventByClientId(tx, operation.id, input.clientEventId)) {
      return replayResult(tx, operation.id, itemIds);
    }

    // Проверяем ВСЕ позиции до первой записи: если что-то не так, ошибка
    // приходит до изменения остатков (§16 — понятная ошибка вместо полупака).
    const warnings: OperationWarning[] = [];
    for (const component of composition) {
      if (component.item.status !== 'active') throw errors.itemInactive(component.item.name);
      checkStock(tx, component.item, component.quantity, warnings);
    }

    const lines: OperationItemRow[] = [];
    const stockAfter: { itemId: number; quantity: number }[] = [];
    const payloadLines: UndoPayloadLine[] = [];

    for (const component of composition) {
      const movement = applyMovement(tx, {
        itemId: component.item.id,
        movementType: 'used_in_operation',
        quantityDelta: -component.quantity,
        operationId: operation.id,
        idempotencyKey: idempotencyKeys.operationPackItem(
          operation.id,
          input.clientEventId,
          component.item.id,
        ),
        actorAccountId: actor.accountId,
      });
      if (!movement.created) return replayResult(tx, operation.id, itemIds);

      const line = upsertOperationLine(
        tx,
        operation.id,
        component.item,
        component.quantity,
        'pack',
        pack.id,
      );
      warnOnLargeQuantity(tx, line, warnings);
      lines.push(line);
      stockAfter.push({ itemId: component.item.id, quantity: movement.quantityAfter });
      payloadLines.push({
        operationItemId: line.id,
        itemId: component.item.id,
        quantity: component.quantity,
      });
    }

    tx.insert(operationEvents)
      .values({
        operationId: operation.id,
        eventType: 'pack_added',
        clientEventId: input.clientEventId,
        payloadJson: JSON.stringify({ packId: pack.id, lines: payloadLines }),
        undoable: true,
        createdAt: new Date(),
      })
      .run();

    touchOperation(tx, operation.id);

    return { lines, applied: true, warnings, stockAfter };
  });
}

// --- Изменение и удаление строки -------------------------------------------

export interface SetLineQuantityInput {
  operationId: number;
  operationItemId: number;
  /** 0 эквивалентно удалению строки (Q-31). */
  quantity: number;
  clientEventId: string;
}

/**
 * §7.9, §10.2, §18.18: изменение количества немедленно корректирует остаток.
 * Уменьшение возвращает разницу на склад движением `returned_from_operation`.
 */
export function setLineQuantity(
  db: AppDatabase,
  actor: Actor,
  input: SetLineQuantityInput,
): AddToOperationResult {
  assertAuthenticated(actor);
  assertNonNegativeQuantity(input.quantity, 'Quantity');
  if (!input.clientEventId?.trim()) {
    throw errors.validationFailed('A client event id is required for every change');
  }

  return runInTransaction(db, (tx) => {
    const operation = loadActiveOperation(tx, input.operationId);

    const line = tx
      .select()
      .from(operationItems)
      .where(
        and(
          eq(operationItems.id, input.operationItemId),
          eq(operationItems.operationId, operation.id),
        ),
      )
      .get();
    if (!line) throw errors.operationLineNotFound();

    if (findEventByClientId(tx, operation.id, input.clientEventId)) {
      return replayResult(tx, operation.id, [line.itemId]);
    }

    const delta = input.quantity - line.quantity;
    if (delta === 0) {
      return { lines: [line], applied: false, warnings: [], stockAfter: [] };
    }

    const warnings: OperationWarning[] = [];
    const item = tx.select().from(items).where(eq(items.id, line.itemId)).get();
    if (!item) throw errors.itemNotFound(line.itemId);
    if (delta > 0) checkStock(tx, item, delta, warnings);

    const movement = applyMovement(tx, {
      itemId: line.itemId,
      movementType: delta > 0 ? 'used_in_operation' : 'returned_from_operation',
      quantityDelta: -delta,
      operationId: operation.id,
      idempotencyKey: idempotencyKeys.operationLineChange(
        operation.id,
        line.id,
        input.clientEventId,
      ),
      actorAccountId: actor.accountId,
    });
    if (!movement.created) return replayResult(tx, operation.id, [line.itemId]);

    let resultLines: OperationItemRow[] = [];
    if (input.quantity === 0) {
      tx.delete(operationItems).where(eq(operationItems.id, line.id)).run();
    } else {
      const updated = tx
        .update(operationItems)
        .set({
          quantity: input.quantity,
          lineTotalCents: lineTotalCents(input.quantity, line.unitCostSnapshotCents),
          updatedAt: new Date(),
        })
        .where(eq(operationItems.id, line.id))
        .returning()
        .get();
      resultLines = [updated];
      warnOnLargeQuantity(tx, updated, warnings);
    }

    tx.insert(operationEvents)
      .values({
        operationId: operation.id,
        eventType: input.quantity === 0 ? 'line_removed' : 'quantity_changed',
        clientEventId: input.clientEventId,
        payloadJson: JSON.stringify({
          operationItemId: line.id,
          from: line.quantity,
          to: input.quantity,
        }),
        // Q-27: Undo откатывает последнее ДОБАВЛЯЮЩЕЕ событие; для ручных
        // изменений количества есть кнопки «+» и «−».
        undoable: false,
        createdAt: new Date(),
      })
      .run();

    touchOperation(tx, operation.id);

    return {
      lines: resultLines,
      applied: true,
      warnings,
      stockAfter: [{ itemId: line.itemId, quantity: movement.quantityAfter }],
    };
  });
}

/** §7.9: удаление ошибочно добавленной строки — всё списанное возвращается. */
export function removeOperationLine(
  db: AppDatabase,
  actor: Actor,
  input: Omit<SetLineQuantityInput, 'quantity'>,
): AddToOperationResult {
  return setLineQuantity(db, actor, { ...input, quantity: 0 });
}

// --- Undo Last Scan ---------------------------------------------------------

export interface UndoLastScanInput {
  operationId: number;
  clientEventId: string;
}

/**
 * Undo Last Scan (§7.4, §7.9; семантика — Q-27).
 *
 * Откатывает последнее добавляющее событие целиком: скан пака отменяется
 * полностью, а не по одной позиции, иначе запрет §16 «нельзя списать половину
 * пака» нарушался бы в обратную сторону. Глубина — один шаг.
 *
 * ДОПУЩЕНИЕ: если после скана количество строки уже уменьшали вручную,
 * возвращается не больше, чем в строке осталось, — иначе операция вернула бы
 * на склад больше, чем реально забрала.
 */
export function undoLastScan(
  db: AppDatabase,
  actor: Actor,
  input: UndoLastScanInput,
): AddToOperationResult {
  assertAuthenticated(actor);
  if (!input.clientEventId?.trim()) {
    throw errors.validationFailed('A client event id is required for undo');
  }

  return runInTransaction(db, (tx) => {
    const operation = loadActiveOperation(tx, input.operationId);

    if (findEventByClientId(tx, operation.id, input.clientEventId)) {
      return replayResult(tx, operation.id, []);
    }

    const event = tx
      .select()
      .from(operationEvents)
      .where(
        and(
          eq(operationEvents.operationId, operation.id),
          eq(operationEvents.undoable, true),
          isNull(operationEvents.undoneAt),
        ),
      )
      .orderBy(desc(operationEvents.id))
      .get();
    if (!event) throw errors.nothingToUndo();

    const payload = JSON.parse(event.payloadJson) as { lines?: UndoPayloadLine[] };
    const payloadLines = payload.lines ?? [];

    const stockAfter: { itemId: number; quantity: number }[] = [];
    const remainingLines: OperationItemRow[] = [];

    for (const entry of payloadLines) {
      const line = tx
        .select()
        .from(operationItems)
        .where(eq(operationItems.id, entry.operationItemId))
        .get();
      const returnQuantity = Math.min(entry.quantity, line?.quantity ?? 0);
      if (returnQuantity <= 0) continue;

      const movement = applyMovement(tx, {
        itemId: entry.itemId,
        movementType: 'returned_from_operation',
        quantityDelta: returnQuantity,
        operationId: operation.id,
        idempotencyKey: idempotencyKeys.operationUndo(operation.id, event.id, entry.itemId),
        actorAccountId: actor.accountId,
      });
      stockAfter.push({ itemId: entry.itemId, quantity: movement.quantityAfter });

      if (!line) continue;
      const nextQuantity = line.quantity - returnQuantity;
      if (nextQuantity === 0) {
        tx.delete(operationItems).where(eq(operationItems.id, line.id)).run();
      } else {
        remainingLines.push(
          tx
            .update(operationItems)
            .set({
              quantity: nextQuantity,
              lineTotalCents: lineTotalCents(nextQuantity, line.unitCostSnapshotCents),
              updatedAt: new Date(),
            })
            .where(eq(operationItems.id, line.id))
            .returning()
            .get(),
        );
      }
    }

    tx.update(operationEvents)
      .set({ undoneAt: new Date() })
      .where(eq(operationEvents.id, event.id))
      .run();

    tx.insert(operationEvents)
      .values({
        operationId: operation.id,
        eventType: 'undo',
        clientEventId: input.clientEventId,
        payloadJson: JSON.stringify({ undoneEventId: event.id }),
        undoable: false,
        createdAt: new Date(),
      })
      .run();

    touchOperation(tx, operation.id);

    return { lines: remainingLines, applied: true, warnings: [], stockAfter };
  });
}

// --- Изменение категории ----------------------------------------------------

export function setProcedureCategory(
  db: AppDatabase,
  actor: Actor,
  operationId: number,
  category: string | null,
): OperationRow {
  assertAuthenticated(actor);
  return runInTransaction(db, (tx) => {
    const operation = loadActiveOperation(tx, operationId);
    return tx
      .update(operations)
      .set({ procedureCategory: category?.trim() || null, updatedAt: new Date() })
      .where(eq(operations.id, operation.id))
      .returning()
      .get();
  });
}

// --- T2: Finish and Lock ----------------------------------------------------

/**
 * §9.2, T2: статус меняется ТОЛЬКО здесь и только по явному действию
 * пользователя. Никакого таймера, cron или фонового задания, переводящего
 * Active → Finished, в системе нет (§9.1, §18.13).
 *
 * Движений остатков не создаётся — они уже созданы при добавлении позиций.
 */
export function finishOperation(
  db: AppDatabase,
  actor: Actor,
  operationId: number,
): OperationRow {
  assertAuthenticated(actor);

  return runInTransaction(db, (tx) => {
    const operation = loadActiveOperation(tx, operationId);
    const total = calculateOperationTotalCents(tx, operation.id);
    const now = new Date();

    const finished = tx
      .update(operations)
      .set({
        status: 'Finished',
        finishedAt: now,
        updatedAt: now,
        totalCostSnapshotCents: total,
        finishedByAccountId: actor.accountId,
      })
      .where(eq(operations.id, operation.id))
      .returning()
      .get();

    tx.insert(operationEvents)
      .values({
        operationId: operation.id,
        eventType: 'finished',
        clientEventId: `finish:${operation.id}`,
        payloadJson: JSON.stringify({ totalCostCents: total }),
        undoable: false,
        createdAt: now,
      })
      .run();

    writeAudit(tx, {
      action: AUDIT_ACTIONS.operationFinished,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'operation',
      entityId: operation.id,
      summary: `Case ${operation.randomCaseCode} locked at ${formatCents(total)}`,
    });

    return finished;
  });
}

// --- T3/T4: Void ------------------------------------------------------------

export interface VoidOperationResult {
  operation: OperationRow;
  /** Что вернулось на склад: ровно чистое списание этой операции. */
  returned: { itemId: number; quantity: number; quantityAfter: number }[];
}

/**
 * Void Operation (§9.3, §10.3, T3/T4). Только Admin (§3.2, §18.22).
 *
 * Возвращается РОВНО чистое списание этой операции по каждому предмету, а не
 * «остаток до операции»: канонический пример §10.3 — 10 → 8 → +20 = 28 → Void
 * → 30. Поставка, сделанная между операцией и аннулированием, остаётся учтённой.
 *
 * Повторный Void невозможен дважды: сначала — проверка статуса, затем —
 * детерминированный ключ `void:{operationId}:item:{itemId}` под уникальным
 * индексом БД. Даже два одновременных запроса дадут ровно один набор
 * возвратов (§18.21, AC-5.2, AC-5.3).
 */
export function voidOperation(
  db: AppDatabase,
  actor: Actor,
  operationId: number,
  reason?: string | null,
): VoidOperationResult {
  assertAdmin(actor, 'void operation');

  return runInTransaction(db, (tx) => {
    const operation = getOperation(tx, operationId);
    if (!operation) throw errors.operationNotFound(operationId);
    if (operation.status === 'Voided') throw errors.operationAlreadyVoided();

    const deductions = netDeductionsByOperation(tx, operation.id);
    const returned: VoidOperationResult['returned'] = [];

    for (const deduction of deductions) {
      const movement = applyMovement(tx, {
        itemId: deduction.itemId,
        movementType: 'void_reversal',
        quantityDelta: deduction.netDeducted,
        operationId: operation.id,
        idempotencyKey: idempotencyKeys.voidReversal(operation.id, deduction.itemId),
        reason: reason?.trim() || 'void',
        actorAccountId: actor.accountId,
      });
      returned.push({
        itemId: deduction.itemId,
        quantity: movement.created ? deduction.netDeducted : 0,
        quantityAfter: movement.quantityAfter,
      });
    }

    const now = new Date();
    // Итог фиксируется и у аннулированной активной операции: карточка обязана
    // сохранить строки и сумму, хотя из финансовых агрегатов операция исключена
    // (§9.3, AC-9.6).
    const total = operation.totalCostSnapshotCents ?? calculateOperationTotalCents(tx, operation.id);

    const voided = tx
      .update(operations)
      .set({
        status: 'Voided',
        voidedAt: now,
        updatedAt: now,
        voidReason: reason?.trim() || null,
        totalCostSnapshotCents: total,
        voidedByAccountId: actor.accountId,
      })
      .where(eq(operations.id, operation.id))
      .returning()
      .get();

    tx.insert(operationEvents)
      .values({
        operationId: operation.id,
        eventType: 'voided',
        clientEventId: `void:${operation.id}`,
        payloadJson: JSON.stringify({ returned }),
        undoable: false,
        createdAt: now,
      })
      .run();

    writeAudit(tx, {
      action: AUDIT_ACTIONS.operationVoided,
      actorAccountId: actor.accountId,
      actorRole: actor.role,
      entityType: 'operation',
      entityId: operation.id,
      summary: `Case ${operation.randomCaseCode} voided, ${returned.length} item(s) returned`,
    });

    return { operation: voided, returned };
  });
}

// --- Чтение списков ---------------------------------------------------------

/** §8.3, §8.5: блок активных операций. Их может быть несколько. */
export function listActiveOperations(tx: DbLike): OperationRow[] {
  return tx
    .select()
    .from(operations)
    .where(eq(operations.status, 'Active'))
    .orderBy(desc(operations.createdAt))
    .all();
}

export interface OperationSummary {
  operation: OperationRow;
  /** §12.1 / C-10: уникальные позиции и общее число единиц — разные величины. */
  itemCount: number;
  unitCount: number;
  totalCostCents: number;
}

export function summarizeOperation(tx: DbLike, operation: OperationRow): OperationSummary {
  const lines = listOperationLines(tx, operation.id);
  return {
    operation,
    itemCount: new Set(lines.map((line) => line.itemId)).size,
    unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    totalCostCents: operationTotalCents(tx, operation),
  };
}

export interface OperationListFilters {
  statuses?: OperationStatus[];
  /**
   * §7.2: поиск по коду операции. Искать больше не по чему и не должно быть:
   * пациентских полей в модели нет (§2.4, §18.3).
   */
  query?: string;
  procedureCategory?: string | null;
  limit?: number;
}

/** §7.2: список операций с поиском и фильтрами. Фильтрация — в SQL. */
export function listOperations(tx: DbLike, filters: OperationListFilters = {}): OperationRow[] {
  const conditions: SQL[] = [];

  if (filters.statuses?.length) {
    conditions.push(inArray(operations.status, filters.statuses));
  }

  const query = filters.query?.trim();
  if (query) {
    // Экранирование служебных символов LIKE — как в listItems() (D-22).
    const term = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    conditions.push(sql`${operations.randomCaseCode} like ${term} escape '\\'`);
  }

  if (filters.procedureCategory) {
    conditions.push(eq(operations.procedureCategory, filters.procedureCategory));
  }

  return tx
    .select()
    .from(operations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(operations.createdAt))
    .limit(filters.limit ?? 100)
    .all();
}

/**
 * Сводка сразу по списку операций одним агрегатом.
 *
 * Отдельный вызов summarizeOperation() на каждую строку списка дал бы N+1
 * запросов на экране, который открывается чаще всех остальных.
 *
 * Итог берётся из снимка для завершённой и аннулированной операции и считается
 * по строкам только для активной: джойн к текущей цене предмета запрещён
 * категорически (§11.3, §18.16).
 */
export function summarizeOperations(tx: DbLike, rows: OperationRow[]): OperationSummary[] {
  if (rows.length === 0) return [];

  const aggregates = tx
    .select({
      operationId: operationItems.operationId,
      itemCount: sql<number>`count(distinct ${operationItems.itemId})`,
      unitCount: sql<number>`coalesce(sum(${operationItems.quantity}), 0)`,
      totalCents: sql<number>`coalesce(sum(${operationItems.lineTotalCents}), 0)`,
    })
    .from(operationItems)
    .where(
      inArray(
        operationItems.operationId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(operationItems.operationId)
    .all();

  const byOperation = new Map(aggregates.map((row) => [row.operationId, row]));

  return rows.map((operation) => {
    const aggregate = byOperation.get(operation.id);
    const linesTotal = aggregate?.totalCents ?? 0;
    return {
      operation,
      itemCount: aggregate?.itemCount ?? 0,
      unitCount: aggregate?.unitCount ?? 0,
      totalCostCents:
        operation.status === 'Active'
          ? linesTotal
          : (operation.totalCostSnapshotCents ?? linesTotal),
    };
  });
}

// --- Разрешение отсканированной строки (§7.5, шаги 1–2) ---------------------

export type ScanTarget =
  | { kind: 'item'; item: ItemRow }
  | { kind: 'pack'; pack: PackRow; components: PackComponent[] };

/**
 * Что означает отсканированная строка (§7.5).
 *
 * Владелец кода определяется по реестру штрихкодов (D-6), а не по префиксу
 * строки: реестр — ограничение БД, префикс — соглашение в коде. Неизвестный код
 * даёт эталонное сообщение §14.4 «Barcode not found».
 */
export function resolveScannedBarcode(tx: DbLike, rawBarcode: string): ScanTarget {
  const barcode = normalizeScannedCode(rawBarcode);
  if (!barcode) throw errors.barcodeNotFound(rawBarcode);

  const owner = findBarcodeOwner(tx, barcode);
  if (!owner) throw errors.barcodeNotFound(barcode);

  if (owner.ownerType === 'pack') {
    const pack = tx.select().from(packs).where(eq(packs.id, owner.ownerId)).get();
    if (!pack) throw errors.packNotFound(owner.ownerId);
    return { kind: 'pack', pack, components: getPackComposition(tx, pack.id) };
  }

  const item = tx.select().from(items).where(eq(items.id, owner.ownerId)).get();
  if (!item) throw errors.itemNotFound(owner.ownerId);
  return { kind: 'item', item };
}

/**
 * §9.3: аннулированные операции исключаются из обычных финансовых итогов.
 * Именно поэтому фильтр по статусу здесь, а не в вызывающем коде.
 */
export function totalCostForFinishedOperations(
  tx: DbLike,
  range?: { fromMs: number; toMs: number },
): number {
  const conditions = [eq(operations.status, 'Finished')];
  if (range) {
    conditions.push(sql`${operations.finishedAt} >= ${range.fromMs}`);
    conditions.push(sql`${operations.finishedAt} <= ${range.toMs}`);
  }
  const row = tx
    .select({ total: sql<number>`coalesce(sum(${operations.totalCostSnapshotCents}), 0)` })
    .from(operations)
    .where(and(...conditions))
    .get();
  return row?.total ?? 0;
}

export type { Tx };
