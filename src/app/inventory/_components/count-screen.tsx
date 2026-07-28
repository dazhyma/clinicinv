'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CountScanTargetView,
  CountSearchResultView,
  InventoryCountStateView,
} from '@/actions/inventory-count';
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
  selectItemForCountServerAction,
} from '../count/actions';
import { CountManualSearchDialog } from './count-manual-search';

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
  const [feedback, setFeedback] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [manualSearchOpen, setManualSearchOpen] = useState(false);

  const scannerRef = useRef<BarcodeCaptureHandle>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const returnToCameraRef = useRef(false);

  // --- Шаг 2: скан предмета -------------------------------------------------

  function openQuantityEntry(item: CountScanTargetView, returnToCamera: boolean) {
    returnToCameraRef.current = returnToCamera;
    setTarget(item);
    setCountedInput(item.countedQuantity != null ? String(item.countedQuantity) : '');
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

  async function confirmManualItem(item: CountSearchResultView) {
    setBusy(true);
    try {
      const result = await selectItemForCountServerAction({
        countId: state.id,
        itemId: item.itemId,
      });
      if (!result.ok) throw new Error(result.error);
      setManualSearchOpen(false);
      openQuantityEntry(result.data, false);
    } finally {
      setBusy(false);
    }
  }

  function continueScanning() {
    if (returnToCameraRef.current) scannerRef.current?.openCamera();
    else scannerRef.current?.focusInput();
  }

  function closeManualSearch() {
    setManualSearchOpen(false);
    window.setTimeout(() => scannerRef.current?.focusInput(), 100);
  }

  // --- Шаги 3–5: фактическое количество, ожидаемое, разница ------------------

  async function saveCountedQuantity() {
    if (!target) return;
    const counted = Number(countedInput);
    if (countedInput.trim() === '' || !Number.isSafeInteger(counted) || counted < 0) {
      setFeedback({ tone: 'error', text: 'Enter the counted quantity as a whole number (0 or more)' });
      quantityRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const result = await recordCountLineServerAction({
        countId: state.id,
        itemId: target.itemId,
        countedQuantity: counted,
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
      router.push(`/inventory?count=${encodeURIComponent(result.data.message)}`);
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
      router.push('/inventory');
    } finally {
      setBusy(false);
    }
  }

  const difference =
    target && countedInput.trim() !== '' && Number.isSafeInteger(Number(countedInput))
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
        label="Item barcode"
        confirmLabel="Confirm Item"
        allowPacks={false}
        disabled={busy || Boolean(target) || manualSearchOpen}
        onConfirm={confirmScannedItem}
      />

      <button
        type="button"
        disabled={busy || Boolean(target)}
        onClick={() => setManualSearchOpen(true)}
        className="rounded-xl border-2 border-slate-400 bg-white px-6 py-4 text-lg font-semibold disabled:opacity-50"
      >
        Find Item Manually
      </button>

      {/* --- Шаги 3–5: найденное количество, ожидаемое, разница --- */}
      {target ? (
        <section className="rounded-2xl border-2 border-slate-900 bg-white p-4">
          <p className="text-xl font-semibold">{target.name}</p>
          <p className="font-mono text-base text-slate-600">{target.internalCode}</p>

          <div className="mt-3 flex flex-wrap items-end gap-4">
            <div>
              <p className="text-base text-slate-600">Expected</p>
              <p className="text-3xl font-bold">
                {target.expectedQuantity}
                <span className="ml-1 text-base font-normal text-slate-600">
                  {target.unitOfMeasurement}
                </span>
              </p>
            </div>

            <div className="min-w-40 flex-1">
              <label htmlFor="counted" className="text-base font-medium text-slate-700">
                Counted on the shelf
              </label>
              <input
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
              />
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
                {difference == null ? '—' : difference > 0 ? `+${difference}` : difference}
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
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
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
                  Expected {line.expectedQuantity} · Counted {line.countedQuantity}
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
                  {line.difference > 0 ? `+${line.difference}` : line.difference}
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
          Apply Corrections
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Apply inventory corrections?"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-2xl font-semibold">Apply inventory corrections?</h2>
            <p className="mt-3 text-lg text-slate-700">
              {state.differenceCount === 0
                ? 'No quantities will change.'
                : `Stock will be corrected for ${state.differenceCount} ${
                    state.differenceCount === 1 ? 'item' : 'items'
                  }. Each correction is recorded as an inventory movement and can be reviewed later.`}
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
                {busy ? 'Applying…' : 'Apply Corrections'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CountManualSearchDialog
        open={manualSearchOpen}
        countId={state.id}
        onClose={closeManualSearch}
        onPick={confirmManualItem}
      />
    </div>
  );
}
