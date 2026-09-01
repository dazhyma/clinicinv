'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CountScanTargetView, InventoryCountStateView } from '@/actions/inventory-count';
import type { BarcodeConfirmationView } from '@/actions/scanning';
import {
  BarcodeCapture,
  type BarcodeCaptureHandle,
  type BarcodeConfirmOutcome,
  type BarcodeScanSource,
} from '../../_components/barcode-capture';
import {
  applyInventoryCountServerAction,
  cancelInventoryCountServerAction,
  recordCountLineServerAction,
  scanForCountServerAction,
} from '../count/actions';
import { useUnsavedChanges } from '../../_components/use-unsaved-changes';

/**
 * Экран инвентаризации (§5.10).
 *
 * Порядок шагов ровно как в ТЗ: скан предмета → ввод физически найденного
 * количества → показ ожидаемого → показ разницы → подтверждение, после которого
 * остаток корректируется движением. Остаток НЕ меняется ни на скане, ни на вводе
 * количества: до подтверждения инвентаризация — черновик.
 *
 * Ничего не хранится только на странице: каждая посчитанная позиция немедленно
 * уходит на сервер, а состояние заменяется присланным целиком. Поэтому §5.10
 * «незавершённая инвентаризация сохраняется при обновлении страницы» выполняется
 * буквально — терять на клиенте нечего.
 *
 * И камера, и HID-сканер сначала показывают read-only карточку. Только Confirm
 * Item открывает поле количества; сам lookup не создаёт строку и не меняет
 * остаток.
 */

type Tone = 'ok' | 'error' | 'pending';

const TONES: Record<Tone, string> = {
  pending: 'bg-slate-100 text-slate-800 ring-slate-300',
  ok: 'bg-emerald-100 text-emerald-950 ring-emerald-400',
  error: 'bg-red-100 text-red-950 ring-red-400',
};

export function CountScreen({ initialState }: { initialState: InventoryCountStateView }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [target, setTarget] = useState<CountScanTargetView | null>(null);
  const [countedInput, setCountedInput] = useState('');
  const [unopenedInput, setUnopenedInput] = useState('');
  const [openMlInput, setOpenMlInput] = useState('');
  const [feedback, setFeedback] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const scannerRef = useRef<BarcodeCaptureHandle>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const returnToCameraRef = useRef(false);
  const hasUnsavedQuantity =
    target !== null &&
    (target.trackingMethod === 'liquid'
      ? unopenedInput !==
          (target.countedUnopenedVials == null ? '' : String(target.countedUnopenedVials)) ||
        openMlInput !== (target.countedOpenVialMl ?? '0')
      : countedInput !== (target.countedQuantity == null ? '' : String(target.countedQuantity)));
  useUnsavedChanges(hasUnsavedQuantity);

  // --- Шаг 2: скан предмета -------------------------------------------------

  function openQuantityEntry(item: CountScanTargetView, returnToCamera: boolean) {
    returnToCameraRef.current = returnToCamera;
    setTarget(item);
    setCountedInput(item.countedQuantity != null ? String(item.countedQuantity) : '');
    setUnopenedInput(item.countedUnopenedVials != null ? String(item.countedUnopenedVials) : '');
    setOpenMlInput(item.countedOpenVialMl ?? '0');
    setFeedback({
      tone: 'ok',
      text: `${item.name} — expected ${item.expectedQuantity} ${item.unitOfMeasurement}`,
    });
    window.setTimeout(() => quantityRef.current?.focus(), 100);
  }

  async function confirmScannedItem(
    candidate: BarcodeConfirmationView,
    source: BarcodeScanSource,
  ): Promise<BarcodeConfirmOutcome> {
    setBusy(true);
    setFeedback({ tone: 'pending', text: `${candidate.name} — opening count…` });
    try {
      // A second read validates that the draft is still open and includes an
      // already-counted value if this item is being revisited.
      const result = await scanForCountServerAction({
        countId: state.id,
        barcode: candidate.barcode,
      });
      if (!result.ok) {
        setFeedback({ tone: 'error', text: result.error });
        setTarget(null);
        return { ok: false, error: result.error };
      }
      openQuantityEntry(result.data, source === 'camera');
      return { ok: true, next: 'close' };
    } catch {
      const message = 'Item could not be opened — check the connection and scan again';
      setFeedback({ tone: 'error', text: message });
      return { ok: false, error: message };
    } finally {
      setBusy(false);
    }
  }

  function continueScanning() {
    if (returnToCameraRef.current) scannerRef.current?.openCamera();
    else scannerRef.current?.focusInput();
  }

  // --- Шаги 3–5: фактическое количество, ожидаемое, разница ------------------

  async function saveCountedQuantity() {
    if (!target) return;
    const counted = Number(countedInput);
    const countedUnopened = Number(unopenedInput);
    if (target.trackingMethod === 'standard' && (countedInput.trim() === '' || !Number.isSafeInteger(counted) || counted < 0)) {
      setFeedback({ tone: 'error', text: 'Enter the counted quantity as a whole number (0 or more)' });
      quantityRef.current?.focus();
      return;
    }
    if (target.trackingMethod === 'liquid' && (unopenedInput.trim() === '' || !Number.isSafeInteger(countedUnopened) || countedUnopened < 0 || !/^\d+(?:\.\d{1,2})?$/.test(openMlInput))) {
      setFeedback({ tone: 'error', text: 'Enter unopened vials and open-vial ml (at most 2 decimal places)' }); return;
    }

    setBusy(true);
    try {
      const result = await recordCountLineServerAction({
        countId: state.id,
        itemId: target.itemId,
        countedQuantity: target.trackingMethod === 'liquid' ? 0 : counted,
        countedUnopenedVials: target.trackingMethod === 'liquid' ? countedUnopened : undefined,
        countedOpenVialMl: target.trackingMethod === 'liquid' ? openMlInput : undefined,
      });
      if (!result.ok) {
        setFeedback({ tone: 'error', text: result.error });
        return;
      }
      setState(result.data.state);
      setFeedback({ tone: 'ok', text: result.data.message });
      setTarget(null);
      setCountedInput('');
      window.setTimeout(continueScanning, 100);
    } catch {
      setFeedback({
        tone: 'error',
        text: `${target.name} was not saved — check the connection and try again`,
      });
    } finally {
      setBusy(false);
    }
  }

  // --- Шаг 6: подтверждение и корректировка остатка --------------------------

  async function confirmApply() {
    setBusy(true);
    try {
      const result = await applyInventoryCountServerAction(state.id);
      if (!result.ok) {
        setFeedback({ tone: 'error', text: result.error });
        setConfirmOpen(false);
        return;
      }
      router.push(`/inventory/count/history/${state.id}`);
    } catch {
      setFeedback({
        tone: 'error',
        text: 'Corrections were not applied — check the connection and try again',
      });
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function cancelCount() {
    setBusy(true);
    try {
      const result = await cancelInventoryCountServerAction(state.id);
      if (!result.ok) {
        setFeedback({ tone: 'error', text: result.error });
        return;
      }
      router.push('/inventory/count');
    } finally {
      setBusy(false);
    }
  }

  const liquidDifference = (() => {
    if (target?.trackingMethod !== 'liquid' || target.liquidVolumePerVialMl == null) return null;
    if (
      unopenedInput.trim() === '' ||
      !Number.isSafeInteger(Number(unopenedInput)) ||
      !/^\d+(?:\.\d{1,2})?$/.test(openMlInput)
    ) return null;
    const countedMl = Number(unopenedInput) * Number(target.liquidVolumePerVialMl) + Number(openMlInput);
    const expectedMl = target.expectedQuantity / 100;
    return Number((countedMl - expectedMl).toFixed(2));
  })();
  const difference = target?.trackingMethod === 'liquid'
    ? liquidDifference
    : target && countedInput.trim() !== '' && Number.isSafeInteger(Number(countedInput))
      ? Number(countedInput) - target.expectedQuantity
      : null;

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-live="polite"
        className={`min-h-20 rounded-2xl px-5 py-4 ring-2 ${
          feedback ? TONES[feedback.tone] : 'bg-white text-slate-500 ring-slate-200'
        }`}
      >
        <p className="text-2xl font-bold break-words">
          {feedback ? feedback.text : 'Scan an item barcode to count it.'}
        </p>
      </section>

      <BarcodeCapture
        ref={scannerRef}
        id="count-scan"
        label="Search or scan an item"
        confirmLabel="Confirm Item"
        allowPacks={false}
        disabled={busy || Boolean(target)}
        onConfirm={confirmScannedItem}
      />

      {/* --- Шаги 3–5: найденное количество, ожидаемое, разница --- */}
      {target ? (
        <section className="rounded-2xl border-2 border-slate-900 bg-white p-4">
          <div className="flex items-center gap-4">
            <div className="min-w-0">
              <p className="text-xl font-semibold">{target.name}</p>
              <p className="font-mono text-base text-slate-600">{target.internalCode}</p>
              {target.referenceNumber ? (
                <p className="text-sm text-slate-600">
                  Ref {target.referenceNumber}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-4">
            <div>
              <p className="text-base text-slate-600">Expected</p>
              <p className="text-3xl font-bold">
                {target.trackingMethod === 'liquid' ? `${target.expectedUnopenedVials} unopened + ${target.expectedOpenVialMl} ml open` : target.expectedQuantity}
                <span className="ml-1 text-base font-normal text-slate-600">
                  {target.unitOfMeasurement}
                </span>
              </p>
            </div>

            <div className="min-w-40 flex-1">
              <label htmlFor="counted" className="text-base font-medium text-slate-700">
                Counted on the shelf
              </label>
              {target.trackingMethod === 'liquid' ? <div className="grid gap-2 sm:grid-cols-2">
                <input ref={quantityRef} type="number" inputMode="numeric" min={0} step={1} value={unopenedInput} onChange={event => setUnopenedInput(event.currentTarget.value)} placeholder="Unopened vials" className="mt-1 w-full rounded-xl border-2 border-slate-400 px-4 py-4 text-xl" />
                <input type="number" inputMode="decimal" min={0} step="0.01" value={openMlInput} onChange={event => setOpenMlInput(event.currentTarget.value)} placeholder="Open vial ml" className="mt-1 w-full rounded-xl border-2 border-slate-400 px-4 py-4 text-xl" />
              </div> : <input
                id="counted"
                ref={quantityRef}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={countedInput}
                onChange={(event) => setCountedInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void saveCountedQuantity();
                  }
                }}
                className="mt-1 w-full rounded-xl border-2 border-slate-400 px-4 py-4 text-2xl"
              />}
            </div>

            <div>
              <p className="text-base text-slate-600">Difference</p>
              <p
                className={`text-3xl font-bold ${
                  difference == null || difference === 0
                    ? 'text-slate-900'
                    : difference > 0
                      ? 'text-emerald-800'
                      : 'text-red-800'
                }`}
              >
                {difference == null ? '—' : `${difference > 0 ? '+' : ''}${difference}${target.trackingMethod === 'liquid' ? ' ml' : ''}`}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveCountedQuantity()}
              className="flex-1 rounded-xl bg-slate-900 px-6 py-4 text-lg font-semibold text-white disabled:opacity-60"
            >
              Save Counted Quantity
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setTarget(null);
                setCountedInput('');
                window.setTimeout(continueScanning, 100);
              }}
              className="rounded-xl border-2 border-slate-400 px-6 py-4 text-lg font-semibold"
            >
              Skip
            </button>
          </div>
          <p className="mt-2 text-base text-slate-600">
            Stock is not changed yet. Quantities are corrected only after you apply the count.
          </p>
        </section>
      ) : null}

      {/* --- Уже посчитанное --- */}
      <section className="app-card p-4">
        <h2 className="mb-3 text-xl font-semibold">
          Counted items ({state.countedItems}) · differences ({state.differenceCount})
        </h2>
        {state.lines.length === 0 ? (
          <p className="text-lg text-slate-600">Nothing counted yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.lines.map((line) => (
              <li
                key={line.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                  line.difference === 0 ? 'border-slate-200' : 'border-amber-400 bg-amber-50'
                }`}
              >
                <div className="min-w-40 flex-1">
                  <p className="text-lg font-semibold">{line.name}</p>
                  <p className="font-mono text-base text-slate-600">{line.internalCode}</p>
                </div>
                <p className="text-lg text-slate-700">
                  {line.trackingMethod === 'liquid'
                    ? `Expected ${line.expectedUnopenedVials} unopened + ${line.expectedOpenVialMl} ml open · Counted ${line.countedUnopenedVials} unopened + ${line.countedOpenVialMl} ml open`
                    : `Expected ${line.expectedQuantity} · Counted ${line.countedQuantity}`}
                </p>
                <p
                  className={`min-w-16 text-right text-2xl font-bold ${
                    line.difference === 0
                      ? 'text-slate-500'
                      : line.difference > 0
                        ? 'text-emerald-800'
                        : 'text-red-800'
                  }`}
                >
                  {line.trackingMethod === 'liquid'
                    ? `${line.difference > 0 ? '+' : ''}${(line.difference / 100).toFixed(2)} ml`
                    : line.difference > 0 ? `+${line.difference}` : line.difference}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Шаг 6: подтверждение отделено от обычных действий --- */}
      <section className="rounded-2xl border-2 border-slate-900 bg-white p-4">
        <button
          type="button"
          disabled={busy || state.lines.length === 0}
          onClick={() => setConfirmOpen(true)}
          className="w-full rounded-xl bg-slate-900 px-6 py-5 text-2xl font-bold text-white disabled:opacity-50"
        >
          Finish Inventory Count
        </button>
        <p className="mt-2 text-base text-slate-600">
          {state.differenceCount === 0
            ? 'No differences found so far. Applying will simply close this count.'
            : `${state.differenceCount} ${state.differenceCount === 1 ? 'item' : 'items'} will be corrected by an inventory count movement.`}
        </p>
      </section>

      <button
        type="button"
        disabled={busy}
        onClick={() => void cancelCount()}
        className="rounded-xl border border-slate-300 bg-white px-6 py-4 text-lg font-medium text-slate-700"
      >
        Cancel this count
      </button>

      {confirmOpen ? (
        <div className="modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Finish this inventory count?"
            className="modal-panel app-card w-full max-w-lg p-6 shadow-[var(--shadow-raised)]"
          >
            <h2 className="text-2xl font-semibold">Finish this inventory count?</h2>
            <p className="mt-3 text-lg text-slate-700">
              Inventory quantities will be updated based on the entered counts.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border border-slate-300 px-6 py-4 text-lg font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmApply()}
                className="rounded-xl bg-slate-900 px-6 py-4 text-lg font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'Finishing…' : 'Finish Inventory Count'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
