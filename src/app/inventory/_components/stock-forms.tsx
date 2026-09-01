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
        label={item.trackingMethod === 'liquid' ? 'Unopened vials received' : 'Quantity received'}
        required
        error={fieldErrors.quantity}
        hint={item.trackingMethod === 'liquid' ? `Current stock: ${item.liquidUnopenedVials} unopened vials` : `Current stock: ${item.currentQuantity} ${item.unitOfMeasurement}`}
      >
        {(props) => <input type="number" inputMode="numeric" min={1} step={1} {...props} />}
      </Field>

      {showCost ? (
        <Field
          name="newCostPerUnit"
          label={item.trackingMethod === 'liquid' ? 'New cost per vial' : 'New cost per unit'}
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
  const [amountInput, setAmountInput] = useState('');
  const [unopenedInput, setUnopenedInput] = useState(String(item.liquidUnopenedVials ?? 0));
  const [openMlInput, setOpenMlInput] = useState((item.liquidOpenVialCentiml / 100).toFixed(2));
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty && !state.ok);
  const standardNewStock = amountInput.trim() === '' || !Number.isFinite(Number(amountInput))
    ? null
    : mode === 'set' ? Number(amountInput) : item.currentQuantity + Number(amountInput);

  return (
    <form action={formAction} onChangeCapture={() => setDirty(true)} className="flex flex-col gap-5">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="clientEventId" value={clientEventId} />

      <ErrorBanner message={state.error} />
      {state.ok ? <SuccessBanner message={state.message} /> : null}

      {item.trackingMethod === 'standard' ? <>{/* Q-21: §5.9 допускает и дельту, и новое фактическое количество.
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
            value={amountInput}
            onChange={(event) => setAmountInput(event.currentTarget.value)}
            {...(mode === 'set' ? { min: 0 } : {})}
            {...props}
          />
        )}
      </Field>
      <p className="rounded-xl bg-slate-50 px-4 py-3 text-lg">
        Current Stock: <strong>{item.currentQuantity}</strong> · New Stock:{' '}
        <strong>{standardNewStock == null ? '—' : standardNewStock}</strong>
      </p>
      </> : <>
        <input type="hidden" name="mode" value="set" />
        <Field name="unopenedVials" label="Unopened vials" required error={fieldErrors.unopenedVials} hint={`Current: ${item.liquidUnopenedVials ?? 0}`}>
          {(props) => <input type="number" inputMode="numeric" min={0} step={1} value={unopenedInput} onChange={(event) => setUnopenedInput(event.currentTarget.value)} {...props} />}
        </Field>
        <Field name="openVialMl" label="Remaining ml in open vial" required error={fieldErrors.openVialMl} hint={`Maximum: ${((item.liquidVolumePerVialCentiml ?? 0) / 100).toFixed(2)} ml`}>
          {(props) => <input type="number" inputMode="decimal" min={0} step="0.01" value={openMlInput} onChange={(event) => setOpenMlInput(event.currentTarget.value)} {...props} />}
        </Field>
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-lg">
          Current Stock: <strong>{item.liquidUnopenedVials} unopened + {(item.liquidOpenVialCentiml / 100).toFixed(2)} ml open</strong>
          {' · '}New Stock: <strong>{unopenedInput || '—'} unopened + {openMlInput || '—'} ml open</strong>
        </p>
      </>}

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
