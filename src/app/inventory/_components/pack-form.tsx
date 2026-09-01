'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { ItemView } from '@/actions/items';
import type { PackView } from '@/actions/packs';
import { formatCents } from '@/domain/money';
import { liquidLineTotalCents } from '@/domain/liquid';
import { useUnsavedChanges } from '../../_components/use-unsaved-changes';
import type { FormState } from '../actions';
import { ErrorBanner, Field, SubmitButton } from './form-field';
import { Select } from '../../_components/ui';

const initialState: FormState = {};

interface CompositionRow {
  key: number;
  itemId: string;
  quantity: string;
}

let nextRowKey = 0;
function makeRow(itemId = '', quantity = '1'): CompositionRow {
  nextRowKey += 1;
  return { key: nextRowKey, itemId, quantity };
}

/**
 * Форма Add New Pack (§6.3) и редактирования пака (§6.7).
 *
 * Поля ровно по §6.2: название, состав с
 * количествами, активный/неактивный статус, необязательные заметки.
 *
 * Чего в форме НЕТ и быть не должно:
 *   - количества самого пака: пак не физический складской объект (§6.5, §18.10);
 *   - поля итоговой стоимости: она вычисляется как Σ(цена предмета × количество)
 *     и не вводится вручную (§6.4). Ниже показывается расчёт, а не ввод;
 *   - внутреннего кода и штрихкода: они постоянны и обычной формой не меняются
 *     (§5.5, §18.6, §18.7) — в режиме редактирования выводятся текстом.
 *
 * Правка состава влияет только на будущие сканирования: завершённые операции
 * хранят собственные снимки и не пересчитываются (§6.7, §18.17).
 */
export function PackForm({
  mode,
  action,
  items,
  pack,
}: {
  mode: 'create' | 'edit';
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Предметы, доступные для выбора. Стоимость приходит только если её видно. */
  items: ItemView[];
  pack?: PackView;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const [dirty, setDirty] = useState(false);
  const fieldErrors = state.fieldErrors ?? {};
  useUnsavedChanges(dirty && !state.ok);

  const [rows, setRows] = useState<CompositionRow[]>(() =>
    pack && pack.components.length > 0
      ? pack.components.map((component) =>
          makeRow(
            String(component.itemId),
            component.trackingMethod === 'liquid'
              ? component.liquidAmountFormatted ?? ''
              : String(component.quantity),
          ),
        )
      : [makeRow()],
  );

  const itemsById = new Map(items.map((item) => [String(item.id), item]));

  function updateRow(key: number, patch: Partial<CompositionRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: number) {
    setRows((current) => (current.length === 1 ? [makeRow()] : current.filter((row) => row.key !== key)));
  }

  // §6.4: расчёт, а не ввод. На экране повторяется та же формула, что считает
  // сервер, поэтому Admin видит стоимость набора до сохранения.
  const costKnown = items.length > 0 && items.every((item) => item.unitCostCents !== undefined);
  let calculatedCents = 0;
  for (const row of rows) {
    const item = itemsById.get(row.itemId);
    const quantity = Number(row.quantity);
    if (item?.unitCostCents === undefined || !Number.isFinite(quantity) || quantity <= 0) continue;
    calculatedCents += item.trackingMethod === 'liquid' && item.costPerMlMicros !== undefined
      ? liquidLineTotalCents(Math.round(quantity * 100), item.costPerMlMicros)
      : item.unitCostCents * Math.max(0, Math.trunc(quantity));
  }

  return (
    <form
      action={formAction}
      onChangeCapture={() => setDirty(true)}
      className="flex flex-col gap-6"
      encType="multipart/form-data"
    >
      {pack ? <input type="hidden" name="packId" value={pack.id} /> : null}

      <ErrorBanner message={state.error} />

      {pack ? (
        <section className="rounded-xl bg-slate-100 px-4 py-3 text-base text-slate-700">
          <p>
            Internal code: <strong className="font-mono">{pack.internalCode}</strong>
          </p>
          <p className="mt-1 text-sm text-slate-500">
            The internal code and its barcode are permanent: renaming the pack or changing its
            contents never changes them (§6.7).
          </p>
        </section>
      ) : null}

      <Field name="name" label="Pack Name" required error={fieldErrors.name}>
        {(props) => <input type="text" defaultValue={pack?.name ?? ''} autoFocus {...props} />}
      </Field>

      {/* --- Состав (§6.3, шаги 3–4) --- */}
      <fieldset className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4">
        <legend className="px-2 text-base font-medium">Items in this pack</legend>

        {items.length === 0 ? (
          <p className="text-base text-slate-600">
            There are no active items yet. Create an item first.
          </p>
        ) : null}

        {fieldErrors.components ? (
          <p role="alert" className="text-base font-medium text-red-700">
            {fieldErrors.components}
          </p>
        ) : null}

        <ul className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const itemError = fieldErrors[`component-${index}-itemId`];
            const quantityError = fieldErrors[`component-${index}-quantity`];
            const selected = itemsById.get(row.itemId);

            return (
              <li key={row.key} className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-56 flex-1 flex-col gap-1">
                  <label htmlFor={`component-${index}-itemId`} className="text-sm text-slate-600">
                    Item
                  </label>
                  <Select
                    id={`component-${index}-itemId`}
                    name="componentItemId"
                    value={row.itemId}
                    onChange={(event) => updateRow(row.key, { itemId: event.target.value })}
                    aria-invalid={itemError ? true : undefined}
                    aria-describedby={itemError ? `component-${index}-itemId-error` : undefined}
                    className="w-full"
                  >
                    <option value="">— select an item —</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.internalCode}
                      </option>
                    ))}
                  </Select>
                  {itemError ? (
                    <p
                      id={`component-${index}-itemId-error`}
                      role="alert"
                      className="text-base font-medium text-red-700"
                    >
                      {itemError}
                    </p>
                  ) : null}
                </div>

                <div className="flex w-32 flex-col gap-1">
                  <label htmlFor={`component-${index}-quantity`} className="text-sm text-slate-600">
                    {selected?.trackingMethod === 'liquid' ? 'Amount (ml)' : 'Quantity'}
                  </label>
                  <input
                    type="hidden"
                    name={selected?.trackingMethod === 'liquid' ? 'componentQuantity' : 'componentLiquidAmountMl'}
                    value=""
                  />
                  <input
                    id={`component-${index}-quantity`}
                    name={selected?.trackingMethod === 'liquid' ? 'componentLiquidAmountMl' : 'componentQuantity'}
                    type="number"
                    inputMode={selected?.trackingMethod === 'liquid' ? 'decimal' : 'numeric'}
                    min={selected?.trackingMethod === 'liquid' ? '0.01' : '1'}
                    step={selected?.trackingMethod === 'liquid' ? '0.01' : '1'}
                    value={row.quantity}
                    onChange={(event) => updateRow(row.key, { quantity: event.target.value })}
                    aria-invalid={quantityError ? true : undefined}
                    aria-describedby={
                      quantityError ? `component-${index}-quantity-error` : undefined
                    }
                    className={`w-full rounded-lg border px-3 py-3 text-lg ${
                      quantityError ? 'border-red-500 bg-red-50' : 'border-slate-300'
                    }`}
                  />
                  {quantityError ? (
                    <p
                      id={`component-${index}-quantity-error`}
                      role="alert"
                      className="text-base font-medium text-red-700"
                    >
                      {quantityError}
                    </p>
                  ) : null}
                </div>

                {selected?.unitCostFormatted ? (
                  <p className="w-28 pb-3 text-base text-slate-600">
                    {selected.trackingMethod === 'liquid'
                      ? `${selected.costPerMlFormatted ?? '$0'} / ml`
                      : `${selected.unitCostFormatted} each`}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-lg text-slate-700"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>

        <div>
          <button
            type="button"
            onClick={() => setRows((current) => [...current, makeRow()])}
            className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-lg font-medium"
          >
            Add item
          </button>
        </div>

        {costKnown ? (
          <p className="border-t border-slate-200 pt-3 text-lg">
            Calculated pack cost: <strong>{formatCents(calculatedCents)}</strong>
            <span className="ml-2 text-sm text-slate-500">
              Sum of (current item cost × quantity). It follows item prices and is never entered by
              hand (§6.4).
            </span>
          </p>
        ) : null}

        <p className="text-sm text-slate-500">
          A pack has no stock of its own: scanning it reduces the stock of the items inside (§6.5).
        </p>
      </fieldset>

      {mode === 'edit' ? (
        <Field name="status" label="Status" error={fieldErrors.status}>
          {(props) => (
            <Select defaultValue={pack?.status ?? 'active'} {...props}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          )}
        </Field>
      ) : null}

      <Field
        name="notes"
        label="Notes"
        hint="Never enter patient information here."
        error={fieldErrors.notes}
      >
        {(props) => <textarea rows={3} defaultValue={pack?.notes ?? ''} {...props} />}
      </Field>

      <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row-reverse sm:justify-start sm:gap-4">
        <SubmitButton>{mode === 'create' ? 'Save Pack' : 'Save Changes'}</SubmitButton>
        <Link
          href="/inventory/packs"
          className="rounded-xl border border-slate-300 px-5 py-4 text-center text-lg text-slate-700"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
