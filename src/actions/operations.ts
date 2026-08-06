/**
 * Действия над операциями (§7, §8, §9).
 *
 * Границы слоя те же, что в `items.ts` и `packs.ts`: роль (§3.2, §18.22) →
 * валидация ввода → вызов домена → конкретное сообщение (§14.4). Ни одного
 * движения остатка, ни одной транзакции здесь нет: остатки, идемпотентность,
 * снимки стоимости и статусы живут в `src/domain/operations.ts`.
 *
 * Две вещи, ради которых этот слой существует именно в таком виде:
 *
 *  1) Каждое мутирующее действие возвращает ПОЛНОЕ состояние операции с сервера.
 *     Экран сканирования показывает результат скана оптимистично (§14.3 — ≤500 мс),
 *     но источником истины остаётся ответ сервера: клиент не «досчитывает»
 *     количества и итоги сам, а заменяет своё представление серверным. Именно
 *     поэтому откат виден пользователю, а не происходит молча.
 *
 *  2) `clientEventId` обязателен в каждом мутирующем действии и приходит от
 *     клиента (§10.4, §16). Повтор того же ключа — успех с `applied: false`,
 *     а не ошибка и не второе списание.
 *
 * Себестоимость режется здесь же, на сервере: при выключенной настройке
 * `staff_can_see_cost` полей стоимости в объекте нет вовсе (D-18).
 */
import type { AppDatabase, DbLike } from '@/db/client';
import {
  OPERATION_STATUSES,
  type OperationItemRow,
  type OperationRow,
  type OperationStatus,
  type SourceType,
} from '@/db/schema';
import { isAdmin, type Actor } from '@/domain/actor';
import { errors } from '@/domain/errors';
import { listItems, searchItems } from '@/domain/items';
import { formatCents } from '@/domain/money';
import {
  addItemToOperation,
  addPackToOperation,
  calculateOperationTotalCents,
  finishOperation,
  getOperation,
  listOperationLines,
  listOperations,
  operationTotalCents,
  resolveScannedBarcode,
  setLineQuantity,
  startOperation,
  summarizeOperations,
  undoLastScan,
  voidOperation,
  type OperationWarning,
} from '@/domain/operations';
import { getPackComposition, listPacks } from '@/domain/packs';
import { getBooleanSetting, SETTING_KEYS } from '@/domain/settings';
import { canSeeCost } from './items';
import { FieldValidator, type RawFormValue } from './parse';
import { failFields, forbidden, ok, runAction, type ActionResult } from './result';

// --- Видимость операций -----------------------------------------------------

/**
 * Q-34 (прямое следствие §7.2): аннулированные операции видит только Admin.
 * Проверка серверная — Staff не получит их ни списком, ни по прямой ссылке.
 */
export function canSeeVoidedOperations(actor: Actor): boolean {
  return isAdmin(actor);
}

function visibleStatuses(actor: Actor): OperationStatus[] {
  return canSeeVoidedOperations(actor)
    ? [...OPERATION_STATUSES]
    : OPERATION_STATUSES.filter((status) => status !== 'Voided');
}

// --- Представление строки и операции ----------------------------------------

/**
 * Строка операции (§7.4, §11.2, §12.2).
 *
 * Все текстовые поля — СНИМКИ на момент добавления, а не текущие значения
 * предмета (§18.15). `sourceType` и `sourcePackName` показывают, что позиция
 * пришла из пака (§7.7, FR-80).
 */
export interface OperationLineView {
  id: number;
  itemId: number;
  name: string;
  internalCode: string;
  referenceNumber: string | null;
  unitOfMeasurement: string;
  quantity: number;
  sourceType: SourceType;
  sourcePackId: number | null;
  sourcePackName: string | null;
  unitCostCents?: number;
  unitCostFormatted?: string;
  lineTotalCents?: number;
  lineTotalFormatted?: string;
}

export interface OperationStateView {
  id: number;
  caseCode: string;
  status: OperationStatus;
  procedureCategory: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  finishedAtMs: number | null;
  voidedAtMs: number | null;
  voidReason: string | null;
  lines: OperationLineView[];
  /** C-10: уникальные позиции и единицы — разные величины, подписаны отдельно. */
  itemCount: number;
  unitCount: number;
  showCost: boolean;
  totalCostCents?: number;
  totalCostFormatted?: string;
  /** §9.3: Void доступен Admin для Active и Finished. */
  canVoid: boolean;
  /** Изменять состав можно только у активной операции (§9.2). */
  canEdit: boolean;
}

function packNamesFor(tx: DbLike, lines: OperationItemRow[]): Map<number, string> {
  const ids = new Set(lines.map((line) => line.sourcePackId).filter((id): id is number => id != null));
  if (ids.size === 0) return new Map();
  return new Map(
    listPacks(tx, { includeInactive: true })
      .filter((pack) => ids.has(pack.id))
      .map((pack) => [pack.id, pack.name]),
  );
}

function toLineView(
  line: OperationItemRow,
  packNames: Map<number, string>,
  options: { showCost: boolean },
): OperationLineView {
  const view: OperationLineView = {
    id: line.id,
    itemId: line.itemId,
    name: line.itemNameSnapshot,
    internalCode: line.internalCodeSnapshot,
    referenceNumber: line.referenceNumberSnapshot,
    unitOfMeasurement: line.unitOfMeasurementSnapshot,
    quantity: line.quantity,
    sourceType: line.sourceType,
    sourcePackId: line.sourcePackId,
    sourcePackName: line.sourcePackId != null ? (packNames.get(line.sourcePackId) ?? null) : null,
  };

  if (!options.showCost) return view;

  return {
    ...view,
    unitCostCents: line.unitCostSnapshotCents,
    unitCostFormatted: formatCents(line.unitCostSnapshotCents),
    lineTotalCents: line.lineTotalCents,
    lineTotalFormatted: formatCents(line.lineTotalCents),
  };
}

function toStateView(tx: DbLike, actor: Actor, operation: OperationRow): OperationStateView {
  const showCost = canSeeCost(tx, actor);
  const rows = listOperationLines(tx, operation.id);
  const packNames = packNamesFor(tx, rows);
  const lines = rows.map((line) => toLineView(line, packNames, { showCost }));

  const view: OperationStateView = {
    id: operation.id,
    caseCode: operation.randomCaseCode,
    status: operation.status,
    procedureCategory: operation.procedureCategory,
    createdAtMs: operation.createdAt.getTime(),
    updatedAtMs: operation.updatedAt.getTime(),
    finishedAtMs: operation.finishedAt?.getTime() ?? null,
    voidedAtMs: operation.voidedAt?.getTime() ?? null,
    voidReason: operation.voidReason,
    lines,
    itemCount: new Set(rows.map((line) => line.itemId)).size,
    unitCount: rows.reduce((sum, line) => sum + line.quantity, 0),
    showCost,
    canVoid: isAdmin(actor) && operation.status !== 'Voided',
    canEdit: operation.status === 'Active',
  };

  if (!showCost) return view;

  const totalCostCents = operationTotalCents(tx, operation);
  return { ...view, totalCostCents, totalCostFormatted: formatCents(totalCostCents) };
}

/**
 * Состояние операции для экрана (§7.4) и для возобновления (§8.3).
 *
 * `undefined` означает «нет такой операции для этого актора»: Staff не должен
 * по прямой ссылке узнать даже факт существования аннулированной операции (Q-34).
 */
export function getOperationState(
  db: AppDatabase,
  actor: Actor,
  operationId: number,
): OperationStateView | undefined {
  const operation = getOperation(db, operationId);
  if (!operation) return undefined;
  if (operation.status === 'Voided' && !canSeeVoidedOperations(actor)) return undefined;
  return toStateView(db, actor, operation);
}

// --- Список операций (§7.2) -------------------------------------------------

export interface OperationRowView {
  id: number;
  caseCode: string;
  status: OperationStatus;
  procedureCategory: string | null;
  createdAtMs: number;
  finishedAtMs: number | null;
  voidedAtMs: number | null;
  itemCount: number;
  unitCount: number;
  canVoid: boolean;
  totalCostCents?: number;
  totalCostFormatted?: string;
}

export interface OperationListQuery {
  q?: string;
  /** 'all' | 'Active' | 'Finished' | 'Voided'. */
  status?: string;
  limit?: number;
}

export interface OperationListResult {
  /** §8.3, §8.5: блок активных операций — их может быть несколько. */
  active: OperationRowView[];
  finished: OperationRowView[];
  /** §7.2: история аннулированных — только Admin. Для Staff всегда пуст. */
  voided: OperationRowView[];
  showCost: boolean;
  canSeeVoided: boolean;
  /** Итог по завершённым в выборке. Аннулированные исключены (§9.3). */
  finishedTotalFormatted?: string;
}

function toRowView(
  summary: { operation: OperationRow; itemCount: number; unitCount: number; totalCostCents: number },
  options: { showCost: boolean; isAdmin: boolean },
): OperationRowView {
  const { operation } = summary;
  const view: OperationRowView = {
    id: operation.id,
    caseCode: operation.randomCaseCode,
    status: operation.status,
    procedureCategory: operation.procedureCategory,
    createdAtMs: operation.createdAt.getTime(),
    finishedAtMs: operation.finishedAt?.getTime() ?? null,
    voidedAtMs: operation.voidedAt?.getTime() ?? null,
    itemCount: summary.itemCount,
    unitCount: summary.unitCount,
    canVoid: options.isAdmin && operation.status !== 'Voided',
  };

  if (!options.showCost) return view;
  return {
    ...view,
    totalCostCents: summary.totalCostCents,
    totalCostFormatted: formatCents(summary.totalCostCents),
  };
}

/**
 * Раздел Operations (§7.2).
 *
 * Активные операции показываются ВСЕГДА и не зависят от фильтра статуса:
 * §8.3 требует предлагать возобновление при каждом возвращении в раздел.
 */
export function listOperationsForActor(
  db: AppDatabase,
  actor: Actor,
  query: OperationListQuery = {},
): OperationListResult {
  const showCost = canSeeCost(db, actor);
  const options = { showCost, isAdmin: isAdmin(actor) };
  const allowed = visibleStatuses(actor);
  const requested = OPERATION_STATUSES.find((status) => status === query.status);
  const selected = requested && allowed.includes(requested) ? [requested] : allowed;

  const block = (status: OperationStatus): OperationRowView[] => {
    if (!selected.includes(status)) return [];
    return summarizeOperations(
      db,
      listOperations(db, { statuses: [status], query: query.q, limit: query.limit }),
    ).map((summary) => toRowView(summary, options));
  };

  const finished = block('Finished');

  const result: OperationListResult = {
    active: block('Active'),
    finished,
    voided: block('Voided'),
    showCost,
    canSeeVoided: canSeeVoidedOperations(actor),
  };

  if (!showCost) return result;

  // §9.3: в итог входят только завершённые операции; аннулированные исключены.
  const finishedTotal = finished.reduce((sum, row) => sum + (row.totalCostCents ?? 0), 0);
  return { ...result, finishedTotalFormatted: formatCents(finishedTotal) };
}

// --- Start New Operation (§7.3) ---------------------------------------------

export interface StartedOperation {
  operationId: number;
  caseCode: string;
}

/**
 * Start New Operation (§7.3).
 *
 * Запись создаётся и сохраняется до первого скана (§8.1) и НИКОГДА не
 * перезаписывает существующую активную операцию (§8.5, §18.24): домен просто
 * вставляет ещё одну строку, ничего не ища и не обновляя.
 *
 * Категория процедуры в этом спринте не вводится: закрытый справочник
 * обобщённых значений заказчиком не утверждён (Q-2), а свободное текстовое поле
 * прямо запрещено §2.4 — персонал впишет туда пациента.
 */
export function startOperationAction(
  db: AppDatabase,
  actor: Actor,
): ActionResult<StartedOperation> {
  return runAction(() => {
    const operation = startOperation(db, actor);
    return { operationId: operation.id, caseCode: operation.randomCaseCode };
  });
}

// --- Общий результат мутации ------------------------------------------------

export interface OperationMutationResult {
  /** Полное состояние с сервера: клиент заменяет им своё представление. */
  state: OperationStateView;
  /** false — событие с этим clientEventId уже применялось (§10.4). */
  applied: boolean;
  /** Крупное подтверждение §7.5: «Gauze 4x4 added». */
  message: string;
  /** §7.10: «Only 2 units remain in inventory» и подобные. */
  warnings: OperationWarning[];
}

function requireClientEventId(v: FieldValidator, value: RawFormValue): string {
  return v.requiredText('clientEventId', value, 'Scan id', 120);
}

function mutationResult(
  db: AppDatabase,
  actor: Actor,
  operationId: number,
  outcome: { applied: boolean; warnings: OperationWarning[] },
  message: string,
): OperationMutationResult {
  const operation = getOperation(db, operationId);
  if (!operation) throw errors.operationNotFound(operationId);
  return {
    state: toStateView(db, actor, operation),
    applied: outcome.applied,
    message,
    warnings: outcome.warnings,
  };
}

// --- Скан (§7.5, §7.6, §7.7) ------------------------------------------------

export interface ScanInput {
  operationId: RawFormValue;
  /** Строка, которую напечатал сканер. Нормализуется в домене. */
  barcode?: RawFormValue;
  clientEventId?: RawFormValue;
}

/**
 * Один скан (§7.5).
 *
 * Порядок ровно как в ТЗ: распознать код → найти предмет или пак → немедленно
 * добавить → сохранить → вернуть текст подтверждения. Ключ идемпотентности
 * приходит от клиента: двойное срабатывание сканера, ретрай после таймаута и
 * повторная отправка не списывают предмет дважды (§10.4, §16).
 */
export function scanIntoOperationAction(
  db: AppDatabase,
  actor: Actor,
  input: ScanInput,
): ActionResult<OperationMutationResult> {
  const v = new FieldValidator();
  const operationId = v.requiredInteger('operationId', input.operationId, 'Operation', { min: 1 });
  const barcode = v.requiredText('barcode', input.barcode, 'Barcode', 120);
  const clientEventId = requireClientEventId(v, input.clientEventId);
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const target = resolveScannedBarcode(db, barcode);

    if (target.kind === 'pack') {
      const outcome = addPackToOperation(db, actor, {
        operationId,
        packId: target.pack.id,
        clientEventId,
      });
      const units = outcome.lines.reduce((sum, line) => sum + line.quantity, 0);
      // §7.5 показывает «Basic Pack added — 6 items»; C-10 требует различать
      // позиции и единицы, поэтому в подтверждении есть обе величины.
      const message = outcome.applied
        ? `${target.pack.name} added — ${outcome.lines.length} items, ${units} units`
        : `${target.pack.name} was already added by this scan`;
      return mutationResult(db, actor, operationId, outcome, message);
    }

    const outcome = addItemToOperation(db, actor, {
      operationId,
      itemId: target.item.id,
      quantity: 1,
      clientEventId,
    });
    const message = outcome.applied
      ? `${target.item.name} added`
      : `${target.item.name} was already added by this scan`;
    return mutationResult(db, actor, operationId, outcome, message);
  });
}

// --- Ручной поиск (§7.8) ----------------------------------------------------

export interface ItemSearchResultView {
  itemId: number;
  name: string;
  internalCode: string;
  referenceNumber: string | null;
  unitOfMeasurement: string;
  currentQuantity: number;
  unitCostFormatted?: string;
}

/** Поиск по названию, системному Item Code и reference/catalog number. */
export function searchItemsForOperationAction(
  db: AppDatabase,
  actor: Actor,
  query: string,
): ActionResult<ItemSearchResultView[]> {
  return runAction(() => {
    const showCost = canSeeCost(db, actor);
    const term = query.trim();
    // Пустой запрос — не ошибка: диалог открывается пустым и показывает
    // ближайшие предметы, чтобы поиск не начинался с пустого экрана.
    const rows = term
      ? searchItems(db, term, { limit: 25 })
      : listItems(db, { limit: 25 });

    return rows.map((item) => {
      const view: ItemSearchResultView = {
        itemId: item.id,
        name: item.name,
        internalCode: item.internalCode,
        referenceNumber: item.referenceNumber,
        unitOfMeasurement: item.unitOfMeasurement,
        currentQuantity: item.currentQuantity,
      };
      if (!showCost) return view;
      return { ...view, unitCostFormatted: formatCents(item.currentUnitCostCents) };
    });
  });
}

export interface AddItemInput {
  operationId: RawFormValue;
  itemId: RawFormValue;
  quantity?: RawFormValue;
  clientEventId?: RawFormValue;
}

/**
 * Добавление предмета из ручного поиска (§7.8).
 * Логика ровно та же, что у скана: то же движение, тот же снимок стоимости.
 */
export function addItemToOperationAction(
  db: AppDatabase,
  actor: Actor,
  input: AddItemInput,
): ActionResult<OperationMutationResult> {
  const v = new FieldValidator();
  const operationId = v.requiredInteger('operationId', input.operationId, 'Operation', { min: 1 });
  const itemId = v.requiredInteger('itemId', input.itemId, 'Item', { min: 1 });
  const quantity =
    input.quantity == null || v.text(input.quantity) === ''
      ? 1
      : v.requiredInteger('quantity', input.quantity, 'Quantity', { min: 1 });
  const clientEventId = requireClientEventId(v, input.clientEventId);
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const outcome = addItemToOperation(db, actor, {
      operationId,
      itemId,
      quantity,
      clientEventId,
    });
    const name = outcome.lines[0]?.itemNameSnapshot ?? 'Item';
    const message = outcome.applied ? `${name} added` : `${name} was already added`;
    return mutationResult(db, actor, operationId, outcome, message);
  });
}

// --- Исправления (§7.9) -----------------------------------------------------

export interface ChangeLineInput {
  operationId: RawFormValue;
  lineId: RawFormValue;
  /** Новое АБСОЛЮТНОЕ количество строки. 0 равносилен удалению (Q-31). */
  quantity: RawFormValue;
  clientEventId?: RawFormValue;
}

/**
 * `−`, `+` и удаление строки (§7.9, §10.2, §18.18).
 *
 * Клиент присылает целевое количество, а не дельту: два быстрых нажатия `+`
 * дают 3 и 4, и результат не зависит от того, успел ли прийти первый ответ.
 * Возврат на склад делает домен движением `returned_from_operation`.
 */
export function changeLineQuantityAction(
  db: AppDatabase,
  actor: Actor,
  input: ChangeLineInput,
): ActionResult<OperationMutationResult> {
  const v = new FieldValidator();
  const operationId = v.requiredInteger('operationId', input.operationId, 'Operation', { min: 1 });
  const lineId = v.requiredInteger('lineId', input.lineId, 'Item line', { min: 1 });
  const quantity = v.requiredInteger('quantity', input.quantity, 'Quantity', { min: 0 });
  const clientEventId = requireClientEventId(v, input.clientEventId);
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const previous = listOperationLines(db, operationId).find((line) => line.id === lineId);
    const name = previous?.itemNameSnapshot ?? 'Item';

    const outcome = setLineQuantity(db, actor, {
      operationId,
      operationItemId: lineId,
      quantity,
      clientEventId,
    });

    const message =
      quantity === 0
        ? `${name} removed — ${previous?.quantity ?? 0} returned to inventory`
        : `${name} set to ${quantity}`;
    return mutationResult(db, actor, operationId, outcome, message);
  });
}

export interface UndoInput {
  operationId: RawFormValue;
  clientEventId?: RawFormValue;
}

/**
 * Undo Last Scan (§7.9, Q-27, D-13).
 * Скан пака откатывается целиком; возвращается не больше, чем в строке осталось.
 */
export function undoLastScanAction(
  db: AppDatabase,
  actor: Actor,
  input: UndoInput,
): ActionResult<OperationMutationResult> {
  const v = new FieldValidator();
  const operationId = v.requiredInteger('operationId', input.operationId, 'Operation', { min: 1 });
  const clientEventId = requireClientEventId(v, input.clientEventId);
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const outcome = undoLastScan(db, actor, { operationId, clientEventId });
    const returned = outcome.stockAfter.length;
    const message = outcome.applied
      ? `Last scan undone — ${returned} ${returned === 1 ? 'item' : 'items'} returned to inventory`
      : 'This undo was already applied';
    return mutationResult(db, actor, operationId, outcome, message);
  });
}

// --- Finish and Lock (§9.2) -------------------------------------------------

export interface FinishedOperation {
  operationId: number;
  caseCode: string;
  itemCount: number;
  unitCount: number;
  totalCostFormatted?: string;
}

/**
 * Finish and Lock (§9.2, §18.14).
 *
 * Статус меняется только этим вызовом и только после явного подтверждения в UI.
 * Никакого автозавершения по таймеру в системе нет (§9.1, §18.13).
 */
export function finishOperationAction(
  db: AppDatabase,
  actor: Actor,
  operationId: number,
): ActionResult<FinishedOperation> {
  return runAction(() => {
    const showCost = canSeeCost(db, actor);
    const lines = listOperationLines(db, operationId);
    const finished = finishOperation(db, actor, operationId);

    const result: FinishedOperation = {
      operationId: finished.id,
      caseCode: finished.randomCaseCode,
      itemCount: new Set(lines.map((line) => line.itemId)).size,
      unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    };
    if (!showCost) return result;
    return {
      ...result,
      totalCostFormatted: formatCents(finished.totalCostSnapshotCents ?? 0),
    };
  });
}

// --- Void (§9.3) ------------------------------------------------------------

export interface VoidedOperation {
  operationId: number;
  caseCode: string;
  returnedItems: number;
  returnedUnits: number;
}

/**
 * Void Operation (§9.3, §10.3, §18.19–§18.21). Только Admin.
 *
 * Роль проверяется здесь и повторно в домене (D-10): прямой вызов из-под Staff
 * в обход интерфейса получает отказ. Повторный Void невозможен — домен отвечает
 * эталонным сообщением «Operation was already voided» (§14.4).
 */
export function voidOperationAction(
  db: AppDatabase,
  actor: Actor,
  operationId: number,
  reason?: RawFormValue,
): ActionResult<VoidedOperation> {
  if (!isAdmin(actor)) return forbidden('void operation');

  const v = new FieldValidator();
  // §9.3: причина необязательна. Пациентских данных в ней быть не может (§18.3) —
  // предупреждение выводится рядом с полем.
  const note = v.optionalText('reason', reason, 500);
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const result = voidOperation(db, actor, operationId, note);
    const returned = result.returned.filter((entry) => entry.quantity !== 0);
    return {
      operationId: result.operation.id,
      caseCode: result.operation.randomCaseCode,
      returnedItems: returned.length,
      returnedUnits: returned.reduce((sum, entry) => sum + entry.quantity, 0),
    };
  });
}

// --- Сводка для Symplast (§12.3) --------------------------------------------

/**
 * Строка сводки (§12.3).
 *
 * Поля: название, reference number, использованное количество и — при
 * необходимости — стоимость. Ничего
 * «на всякий случай» здесь появиться не может: §18.3 и FR-125 запрещают любые
 * поля, куда можно вписать пациента, а лишнее поле в сводке для ручного
 * переноса — ровно такое место.
 */
export interface OperationSummaryLine {
  itemId: number;
  name: string;
  /** Reference/catalog number производителя, если он задан. */
  reference: string | null;
  referenceKind: 'Ref' | null;
  quantity: number;
  unitOfMeasurement: string;
  unitCostFormatted?: string;
  lineTotalFormatted?: string;
}

export interface OperationSummaryView {
  operationId: number;
  caseCode: string;
  lines: OperationSummaryLine[];
  itemCount: number;
  unitCount: number;
  showCost: boolean;
  totalCostFormatted?: string;
  /** Готовый текст для Copy Summary: колонки разделены табуляцией. */
  text: string;
}

const SUMMARY_COLUMN_SEPARATOR = '\t';

function summaryText(view: Omit<OperationSummaryView, 'text'>): string {
  const rows: string[] = [`Case ${view.caseCode}`];

  const header = ['Item', 'Reference', 'Qty'];
  if (view.showCost) header.push('Unit cost', 'Line total');
  rows.push(header.join(SUMMARY_COLUMN_SEPARATOR));

  for (const line of view.lines) {
    const cells = [line.name, line.reference ?? '', String(line.quantity)];
    if (view.showCost) cells.push(line.unitCostFormatted ?? '', line.lineTotalFormatted ?? '');
    rows.push(cells.join(SUMMARY_COLUMN_SEPARATOR));
  }

  if (view.showCost && view.totalCostFormatted) {
    rows.push(`Total${SUMMARY_COLUMN_SEPARATOR}${view.totalCostFormatted}`);
  }

  return rows.join('\n');
}

/**
 * Сводка использованных материалов для ручного переноса в Symplast (§12.3).
 *
 * Три свойства, ради которых функция устроена именно так:
 *
 *  1) Все величины берутся из СНИМКОВ строки операции (`unit_cost_snapshot_cents`,
 *     `line_total_cents`) и из снимка итога. Джойна к текущей цене предмета нет
 *     ни здесь, ни в `toStateView()` — §11.3 и §18.16.
 *
 *  2) Позиции сводки агрегируются по предмету: в Symplast переносят «сколько
 *     штук предмета израсходовано», а не «сколько строк было в операции». Скан
 *     предмета отдельно и он же в составе пака дают одну строку сводки. Внутри
 *     карточки операции (§12.2) источник добавления по-прежнему виден построчно.
 *
 *  3) Стоимость режется отсутствием полей (D-18): при выключенном
 *     `staff_can_see_cost` в объекте нет ни `unitCostFormatted`, ни
 *     `lineTotalFormatted`, ни `totalCostFormatted`, и в текст они не попадают.
 *
 * Сводка существует только у завершённой операции: у аннулированной материалы
 * возвращены на склад (§9.3), и переносить в Symplast нечего.
 */
export function getOperationSummary(
  db: AppDatabase,
  actor: Actor,
  operationId: number,
): OperationSummaryView | undefined {
  const operation = getOperation(db, operationId);
  if (!operation) return undefined;
  if (operation.status !== 'Finished') return undefined;

  const showCost = canSeeCost(db, actor);
  const rows = listOperationLines(db, operation.id);

  // Порядок предметов — порядок первого появления в операции: так строка сводки
  // соответствует тому, что персонал видел на экране во время процедуры.
  const grouped = new Map<
    number,
    { line: OperationSummaryLine; unitCosts: Set<number>; totalCents: number }
  >();

  for (const row of rows) {
    const existing = grouped.get(row.itemId);
    if (existing) {
      existing.line.quantity += row.quantity;
      existing.unitCosts.add(row.unitCostSnapshotCents);
      existing.totalCents += row.lineTotalCents;
      continue;
    }

    grouped.set(row.itemId, {
      line: {
        itemId: row.itemId,
        name: row.itemNameSnapshot,
        reference: row.referenceNumberSnapshot,
        referenceKind: row.referenceNumberSnapshot ? 'Ref' : null,
        quantity: row.quantity,
        unitOfMeasurement: row.unitOfMeasurementSnapshot,
      },
      unitCosts: new Set([row.unitCostSnapshotCents]),
      totalCents: row.lineTotalCents,
    });
  }

  const lines = [...grouped.values()].map(({ line, unitCosts, totalCents }) => {
    if (!showCost) return line;
    // Один и тот же предмет мог попасть в операцию по разной цене (D-5).
    // Тогда «стоимость единицы» у объединённой строки не существует, и
    // выдумывать среднюю нельзя — печатается только сумма.
    const [single] = unitCosts.size === 1 ? [...unitCosts] : [undefined];
    return {
      ...line,
      ...(single !== undefined ? { unitCostFormatted: formatCents(single) } : {}),
      lineTotalFormatted: formatCents(totalCents),
    };
  });

  const base: Omit<OperationSummaryView, 'text'> = {
    operationId: operation.id,
    caseCode: operation.randomCaseCode,
    lines,
    itemCount: lines.length,
    unitCount: rows.reduce((sum, row) => sum + row.quantity, 0),
    showCost,
    ...(showCost
      ? { totalCostFormatted: formatCents(operationTotalCents(db, operation)) }
      : {}),
  };

  return { ...base, text: summaryText(base) };
}

// --- Индекс штрихкодов для оптимистичного отклика (§14.3) -------------------

/**
 * Что показать пользователю СРАЗУ после скана, до ответа сервера.
 *
 * §14.3 требует реакции ≤500 мс. Клиент не может назвать предмет по коду, не
 * зная соответствия, поэтому небольшой индекс «код → название» отдаётся вместе
 * со страницей. Это ТОЛЬКО подсказка для мгновенного отклика: количества,
 * остатки и стоимость приходят от сервера и заменяют оптимистичное состояние.
 *
 * Стоимости в индексе нет намеренно: она не нужна для отклика и не должна
 * попадать в клиентский бандл Staff при выключенной настройке (D-18).
 */
export interface ScanIndexEntry {
  barcode: string;
  kind: 'item' | 'pack';
  id: number;
  name: string;
  unitOfMeasurement?: string;
  /** Для пака — состав, чтобы оптимистично показать все позиции сразу. */
  components?: { itemId: number; name: string; quantity: number; unitOfMeasurement: string }[];
}

export function scanIndexForActor(db: AppDatabase): ScanIndexEntry[] {
  const entries: ScanIndexEntry[] = listItems(db, { limit: 2000 }).map((item) => ({
    barcode: item.barcodeValue,
    kind: 'item' as const,
    id: item.id,
    name: item.name,
    unitOfMeasurement: item.unitOfMeasurement,
  }));

  for (const pack of listPacks(db, {})) {
    entries.push({
      barcode: pack.barcodeValue,
      kind: 'pack',
      id: pack.id,
      name: pack.name,
      components: getPackComposition(db, pack.id).map((component) => ({
        itemId: component.item.id,
        name: component.item.name,
        quantity: component.quantity,
        unitOfMeasurement: component.item.unitOfMeasurement,
      })),
    });
  }

  return entries;
}

/** §7.5, шаг 6: звук воспроизводится, если это включено настройкой и поддержано устройством. */
export function soundOnScanEnabled(db: AppDatabase): boolean {
  return getBooleanSetting(db, SETTING_KEYS.soundOnScanEnabled, true);
}

export { ok, calculateOperationTotalCents };
