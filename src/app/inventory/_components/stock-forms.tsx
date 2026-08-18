'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ADJUSTMENT_REASONS } from '@/db/schema';
import type { ItemView } from '@/actions/items';
import type { FormState } from '../actions';
import { newClientEventId } from '../../_components/client-event-id';
import { useUnsavedChanges } from '../../_components/use-unsaved-changes';
import { ErrorBanner, Field, SubmitButton, SuccessBanner } from './form-field';
import { Select } from '../../_components/ui';

const initialState: FormState = {};

/**
 * Ключ идемпотентности живёт в состоянии формы и меняется ТОЛЬКО после
 * подтверждённого успеха (§10.4, §16).
 *
 * Практический смысл: двойной клик, повторная отправка по Enter и ретрай после
 * сетевого таймаута уходят на сервер с одним и тем же ключом, поэтому поставка
 * не начисляется дважды. Гарантию даёт уникальный индекс в БД, а не эта
 * функция — здесь только источник ключа.
 */
function useIdempotencyKey(state: FormState): string {
  const [key, setKey] = useState(newClientEventId);
  useEffect(() => {
    if (state.ok) setKey(newClientEventId());
  }, [state]);
  return key;
}

/** Receive Stock (§5.8). */
export function ReceiveStockForm({
  item,
  action,
  showCost,
  returnToScanner,
}: {
  item: ItemView;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  showCost: boolean;
  returnToScanner?: 'camera' | 'hid';
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, initialState);
  const fieldErrors = state.fieldErrors ?? {};
  const clientEventId = useIdempotencyKey(state);
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty && !state.ok);

  useEffect(() => {
    if (!state.ok || !returnToScanner) return;
    router.push(returnToScanner === 'camera' ? '/inventory/receive?camera=1' : '/inventory/receive');
  }, [returnToScanner, router, state.ok]);

  return (
    <form action={formAction} onChangeCapture={() => setDirty(true)} className="flex flex-col gap-5">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="clientEventId" value={clientEventId} />

      <ErrorBanner message={state.error} />
      {state.ok ? <SuccessBanner message={state.message} /> : null}

      <Field
        name="quantity"
        label="Quantity received"
        required
        error={fieldErrors.quantity}
        hint={`Current stock: ${item.currentQuantity} ${item.unitOfMeasurement}`}
      >
        {(props) => <input type="number" inputMode="numeric" min={1} step={1} {...props} />}
      </Field>

      {showCost ? (
        <Field
          name="newCostPerUnit"
          label="New cost per unit"
          error={fieldErrors.newCostPerUnit}
          hint="Leave empty to keep the current cost. A new cost applies to future surgeries only; finished surgeries never change."
        >
          {(props) => (
            <input
              type="text"
              inputMode="decimal"
              placeholder={item.unitCostFormatted?.replace('$', '') ?? ''}
              {...props}
            />
          )}
        </Field>
      ) : null}

      <Field
        name="reason"
        label="Note"
        error={fieldErrors.reason}
        hint="For example a supplier or delivery reference. Never enter patient information."
      >
        {(props) => <input type="text" {...props} />}
      </Field>

      <SubmitButton pendingLabel="Receiving…">Receive Stock</SubmitButton>
    </form>
  );
}

/** Ручная корректировка остатка (§5.9). */
export function AdjustStockForm({
  item,
  action,
}: {
  item: ItemView;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const fieldErrors = state.fieldErrors ?? {};
  const clientEventId = useIdempotencyKey(state);
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty && !state.ok);

  return (
    <form action={formAction} onChangeCapture={() => setDirty(true)} className="flex flex-col gap-5">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="clientEventId" value={clientEventId} />

      <ErrorBanner message={state.error} />
      {state.ok ? <SuccessBanner message={state.message} /> : null}

      {/* Q-21: §5.9 допускает и дельту, и новое фактическое количество.
          В журнал движений в обоих случаях пишется дельта. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-medium">Adjustment type</legend>
        <div className="flex flex-wrap gap-3">
          {(
            [
              { value: 'delta', label: 'Change by' },
              { value: 'set', label: 'Set to' },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-lg ${
                mode === option.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        name="amount"
        label={mode === 'delta' ? 'Quantity change' : 'New actual quantity'}
        required
        error={fieldErrors.amount}
        hint={
          mode === 'delta'
            ? `Use a negative number to remove units. Current stock: ${item.currentQuantity}`
            : `Current stock: ${item.currentQuantity}`
        }
      >
        {(props) => (
          <input
            type="number"
            inputMode="numeric"
            step={1}
            {...(mode === 'set' ? { min: 0 } : {})}
            {...props}
          />
        )}
      </Field>

      {/* §5.9: причина обязательна и выбирается из фиксированного списка. */}
      <Field name="reason" label="Reason" required error={fieldErrors.reason}>
        {(props) => (
          <Select defaultValue="" {...props}>
            <option value="" disabled>
              Select a reason…
            </option>
            {ADJUSTMENT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        name="notes"
        label="Comment"
        error={fieldErrors.notes}
        hint="Never enter patient information."
      >
        {(props) => <input type="text" {...props} />}
      </Field>

      <SubmitButton pendingLabel="Adjusting…" variant="danger">
        Save Adjustment
      </SubmitButton>
    </form>
  );
}
