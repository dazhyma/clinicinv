/**
 * Действия над паками (§6).
 *
 * Границы слоя те же, что и в `items.ts`: роль (§3.2, §18.22) → валидация формы
 * → вызов домена → конкретное сообщение (§14.4). Логики остатков здесь нет и
 * быть не может: пак не является складским объектом (§6.5, §18.10).
 *
 * Стоимость пака ВСЕГДА вычисляется (§6.4): сумма (текущая стоимость предмета ×
 * количество в паке). Ни поля ручного ввода итога, ни хранимого значения нет —
 * иначе оно разошлось бы с ценами предметов. Для Staff при выключенной
 * настройке `staff_can_see_cost` полей стоимости нет в объекте вовсе (D-18).
 */
import type { AppDatabase, DbLike } from '@/db/client';
import { ENTITY_STATUSES, type EntityStatus, type PackRow } from '@/db/schema';
import { isAdmin, type Actor } from '@/domain/actor';
import { errors } from '@/domain/errors';
import { getItem } from '@/domain/items';
import { formatCents } from '@/domain/money';
import {
  createPack,
  getPack,
  getPackComposition,
  listPacks,
  updatePack,
  type PackComponent,
} from '@/domain/packs';
import { canSeeCost } from './items';
import { FieldValidator, type RawFormValue } from './parse';
import { failFields, forbidden, ok, runAction, type ActionResult } from './result';

// --- Представление ----------------------------------------------------------

/**
 * Позиция состава пака.
 *
 * `itemQuantityInStock` — остаток ПРЕДМЕТА, а не пака: собственного остатка у
 * пака нет (§6.5). Поле нужно, чтобы Admin видел, чем пак укомплектован
 * фактически, и не печатал этикетку набора, который нечем собрать.
 */
export interface PackComponentView {
  itemId: number;
  name: string;
  internalCode: string;
  sku: string | null;
  referenceNumber: string | null;
  unitOfMeasurement: string;
  /** Сколько единиц предмета входит в пак. */
  quantity: number;
  itemQuantityInStock: number;
  itemStatus: EntityStatus;
  unitCostCents?: number;
  unitCostFormatted?: string;
  lineTotalCents?: number;
  lineTotalFormatted?: string;
}

/**
 * Пак для списка и карточки (§6.2).
 *
 * Полей количества у самого пака нет — ни `currentQuantity`, ни «в наличии»
 * (§6.5, §18.10). `totalUnits` — сумма количеств в СОСТАВЕ, то есть сколько
 * единиц спишется при одном скане, а не складской остаток.
 */
export interface PackView {
  id: number;
  internalCode: string;
  barcodeValue: string;
  name: string;
  photoUrl: string | null;
  notes: string | null;
  status: EntityStatus;
  components: PackComponentView[];
  /** Количество позиций в составе. */
  componentCount: number;
  /** Сколько единиц спишет один скан пака. */
  totalUnits: number;
  costCents?: number;
  costFormatted?: string;
}

export function toPackView(
  pack: PackRow,
  composition: PackComponent[],
  options: { showCost: boolean },
): PackView {
  const components: PackComponentView[] = composition.map((component) => {
    const base: PackComponentView = {
      itemId: component.item.id,
      name: component.item.name,
      internalCode: component.item.internalCode,
      sku: component.item.sku,
      referenceNumber: component.item.referenceNumber,
      unitOfMeasurement: component.item.unitOfMeasurement,
      quantity: component.quantity,
      itemQuantityInStock: component.item.currentQuantity,
      itemStatus: component.item.status,
    };

    if (!options.showCost) return base;

    const lineTotal = component.item.currentUnitCostCents * component.quantity;
    return {
      ...base,
      unitCostCents: component.item.currentUnitCostCents,
      unitCostFormatted: formatCents(component.item.currentUnitCostCents),
      lineTotalCents: lineTotal,
      lineTotalFormatted: formatCents(lineTotal),
    };
  });

  const view: PackView = {
    id: pack.id,
    internalCode: pack.internalCode,
    barcodeValue: pack.barcodeValue,
    name: pack.name,
    photoUrl: pack.photoUrl,
    notes: pack.notes,
    status: pack.status,
    components,
    componentCount: components.length,
    totalUnits: components.reduce((total, component) => total + component.quantity, 0),
  };

  if (!options.showCost) return view;

  // §6.4: считается здесь и сейчас по текущим ценам. Изменение цены предмета
  // меняет это число автоматически и не касается завершённых операций (§11.3).
  const costCents = composition.reduce(
    (total, component) => total + component.item.currentUnitCostCents * component.quantity,
    0,
  );

  return { ...view, costCents, costFormatted: formatCents(costCents) };
}

// --- Чтение -----------------------------------------------------------------

export interface PackListResult {
  packs: PackView[];
  showCost: boolean;
}

/**
 * Список паков (§6.1). Чтение доступно обеим ролям: Staff сканирует паки (§3.2)
 * и должен видеть, что в них входит; режется только стоимость.
 */
export function listPacksForActor(
  db: AppDatabase,
  actor: Actor,
  query: { includeInactive?: boolean; q?: string } = {},
): PackListResult {
  const showCost = canSeeCost(db, actor);
  const includeInactive = Boolean(query.includeInactive) && isAdmin(actor);

  const rows = listPacks(db, { includeInactive, query: query.q });

  return {
    packs: rows.map((row) => toPackView(row, getPackComposition(db, row.id), { showCost })),
    showCost,
  };
}

export function getPackForActor(
  db: AppDatabase,
  actor: Actor,
  packId: number,
): PackView | undefined {
  const row = getPack(db, packId);
  if (!row) return undefined;
  return toPackView(row, getPackComposition(db, packId), { showCost: canSeeCost(db, actor) });
}

// --- Форма (§6.3) -----------------------------------------------------------

export interface PackComponentFormInput {
  itemId?: RawFormValue;
  quantity?: RawFormValue;
}

export interface PackFormInput {
  name?: RawFormValue;
  notes?: RawFormValue;
  status?: RawFormValue;
  /** URL уже сохранённого файла; загрузку выполняет `'use server'`-обёртка. */
  photoUrl?: string | null;
  components?: PackComponentFormInput[];
}

export interface SavedPack {
  packId: number;
  internalCode: string;
  name: string;
  /** URL прежней фотографии, если она была заменена: файл можно удалить. */
  replacedPhotoUrl: string | null;
}

/** Имя поля ошибки строки состава. Совпадает с id инпута в форме. */
export function componentFieldName(index: number, field: 'itemId' | 'quantity'): string {
  return `component-${index}-${field}`;
}

interface ValidatedComponent {
  itemId: number;
  quantity: number;
}

/**
 * Разбор состава (§6.3, шаги 3–4).
 *
 * Полностью пустая строка формы игнорируется: пользователь мог открыть лишнюю.
 * Строка, где выбран предмет без количества (или наоборот), — ошибка именно
 * этой строки, а не общая (§14.4).
 */
function validateComponents(
  db: DbLike,
  rows: PackComponentFormInput[],
  v: FieldValidator,
): ValidatedComponent[] {
  const components: ValidatedComponent[] = [];
  const seen = new Map<number, number>();

  rows.forEach((row, index) => {
    const rawItemId = v.text(row.itemId);
    const rawQuantity = v.text(row.quantity);
    if (!rawItemId && !rawQuantity) return;

    const itemId = v.requiredInteger(componentFieldName(index, 'itemId'), rawItemId, 'Item', {
      min: 1,
    });
    const quantity = v.requiredInteger(
      componentFieldName(index, 'quantity'),
      rawQuantity,
      'Quantity',
      { min: 1 },
    );
    if (!itemId || !quantity) return;

    const item = getItem(db, itemId);
    if (!item) {
      v.add(componentFieldName(index, 'itemId'), 'Item not found');
      return;
    }
    if (seen.has(itemId)) {
      v.add(
        componentFieldName(index, 'itemId'),
        `${item.name} is already listed in row ${seen.get(itemId)! + 1}`,
      );
      return;
    }

    seen.set(itemId, index);
    components.push({ itemId, quantity });
  });

  if (components.length === 0 && !v.hasErrors) {
    v.add('components', 'Add at least one item to the pack');
  }

  return components;
}

function validatePackFields(
  db: DbLike,
  input: PackFormInput,
  v: FieldValidator,
): { name: string; notes: string | null; components: ValidatedComponent[] } {
  return {
    name: v.requiredText('name', input.name, 'Pack Name'),
    notes: v.optionalText('notes', input.notes, 2000),
    components: validateComponents(db, input.components ?? [], v),
  };
}

/**
 * Add New Pack (§6.3).
 *
 * Внутренний код `PCK-000015` и штрихкод создаёт домен внутри транзакции
 * (§5.5, §18.6): формой их ни задать, ни изменить нельзя.
 */
export function createPackAction(
  db: AppDatabase,
  actor: Actor,
  input: PackFormInput,
): ActionResult<SavedPack> {
  // Роль — до валидации: Staff не должен даже узнавать состав формы (§18.22).
  if (!isAdmin(actor)) return forbidden('create pack');

  const v = new FieldValidator();
  const fields = validatePackFields(db, input, v);
  const status = input.status
    ? v.oneOf('status', input.status, ENTITY_STATUSES, 'Status')
    : undefined;
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const created = createPack(db, actor, {
      name: fields.name,
      notes: fields.notes,
      composition: fields.components,
      photoUrl: input.photoUrl ?? null,
      ...(status ? { status } : {}),
    });

    return {
      packId: created.id,
      internalCode: created.internalCode,
      name: created.name,
      replacedPhotoUrl: null,
    };
  });
}

/**
 * Редактирование пака и его состава (§6.7).
 *
 * Состав заменяется целиком, но НИ ОДНА строка операции при этом не трогается:
 * завершённые операции сохраняют исходный состав, количества и историческую
 * стоимость (§6.7, §18.17). Внутренний код и штрихкод недостижимы: их нет в
 * `PackFormInput`, а доменный `updatePack()` отвергает попытку их передать.
 */
export function updatePackAction(
  db: AppDatabase,
  actor: Actor,
  packId: number,
  input: PackFormInput,
): ActionResult<SavedPack> {
  if (!isAdmin(actor)) return forbidden('edit pack');

  const v = new FieldValidator();
  const fields = validatePackFields(db, input, v);
  const status = input.status
    ? v.oneOf('status', input.status, ENTITY_STATUSES, 'Status')
    : undefined;
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    const existing = getPack(db, packId);
    if (!existing) throw errors.packNotFound(packId);

    const photoChanged = input.photoUrl !== undefined && input.photoUrl !== existing.photoUrl;

    const updated = updatePack(db, actor, packId, {
      name: fields.name,
      notes: fields.notes,
      composition: fields.components,
      ...(photoChanged ? { photoUrl: input.photoUrl ?? null } : {}),
      ...(status ? { status } : {}),
    });

    return {
      packId: updated.id,
      internalCode: updated.internalCode,
      name: updated.name,
      replacedPhotoUrl: photoChanged ? existing.photoUrl : null,
    };
  });
}

export { ok };
