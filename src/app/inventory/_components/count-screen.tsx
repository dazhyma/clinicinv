'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CountScanTargetView,
  InventoryCountStateView,
} from '@/actions/inventory-count';
import {
  applyInventoryCountServerAction,
  cancelInventoryCountServerAction,
  recordCountLineServerAction,
  scanForCountServerAction,
} from '../count/actions';

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
 * Поле сканирования удерживает фокус так же, как на операционном экране (D-34):
 * единственное исключение — ввод найденного количества, куда пользователь
 * печатает число, и открытый диалог подтверждения.
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

  const scanRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  const focusScanner = useCallback(() => {
    if (typeof document === 'undefined') return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest('[role="dialog"]')) return;
    if (active === quantityRef.current) return;
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    focusScanner();
  }, [focusScanner]);

  // --- Шаг 2: скан предмета -------------------------------------------------

  async function handleScan(raw: string) {
    const barcode = raw.trim();
    if (!barcode) return;

    setBusy(true);
    setFeedback({ tone: 'pending', text: `${barcode} — checking…` });
    try {
      const result = await scanForCountServerAction({ countId: state.id, barcode });
      if (!result.ok) {
        // §14.4: «Barcode not found», «… is a pack — scan the item barcodes instead».
        setFeedback({ tone: 'error', text: result.error });
        setTarget(null);
        return;
      }
      setTarget(result.data);
      setCountedInput(
        result.data.countedQuantity != null ? String(result.data.countedQuantity) : '',
      );
      setFeedback({
        tone: 'ok',
        text: `${result.data.name} — expected ${result.data.expectedQuantity} ${result.data.unitOfMeasurement}`,
      });
      window.setTimeout(() => quantityRef.current?.focus(), 0);
    } catch {
      setFeedback({
        tone: 'error',
        text: 'Not saved — check the connection and scan again',
      });
    } finally {
      setBusy(false);
    }
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
      focusScanner();
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

      {/* --- Шаг 2: поле сканирования --- */}
      <form
        className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"
        onSubmit={(event) => {
          event.preventDefault();
          const input = scanRef.current;
          if (!input) return;
          const value = input.value;
          input.value = '';
          void handleScan(value);
        }}
      >
        <label htmlFor="count-scan" className="text-base font-medium text-slate-700">
          Item barcode
        </label>
        <input
          id="count-scan"
          ref={scanRef}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Ready to scan"
          className="mt-1 w-full rounded-xl border-2 border-slate-400 px-4 py-4 font-mono text-2xl"
        />
      </form>

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
                focusScanner();
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
    </div>
  );
}
