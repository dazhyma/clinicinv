'use client';

import { useEffect, useRef, useState } from 'react';
import type { CountSearchResultView } from '@/actions/inventory-count';
import { searchItemsForCountServerAction } from '../count/actions';

/**
 * Ручной поиск для Inventory Count. Выбор только подтверждает предмет и
 * открывает ввод фактического количества; сам поиск остаток не меняет.
 */
export function CountManualSearchDialog({
  open,
  countId,
  onClose,
  onPick,
}: {
  open: boolean;
  countId: number;
  onClose: () => void;
  onPick: (item: CountSearchResultView) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CountSearchResultView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError(null);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const result = await searchItemsForCountServerAction({ countId, query });
        if (cancelled) return;
        if (result.ok) {
          setResults(result.data);
          setError(null);
        } else {
          setResults([]);
          setError(result.error);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setError('Search is not available — check the connection');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [countId, open, query]);

  if (!open) return null;

  async function pick(item: CountSearchResultView) {
    setSelectingId(item.itemId);
    setError(null);
    try {
      await onPick(item);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Item could not be opened');
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-slate-900/60 p-3 sm:p-6"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectingId == null) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find an item manually"
        className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-2xl bg-white p-4 shadow-xl sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Find Item Manually</h2>
          <button
            type="button"
            disabled={selectingId != null}
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <label htmlFor="count-manual-search" className="sr-only">
          Search by name, internal code, SKU or reference number
        </label>
        <input
          id="count-manual-search"
          ref={inputRef}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, internal code, SKU or reference number"
          className="w-full rounded-xl border border-slate-300 px-4 py-4 text-xl"
        />

        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-lg text-red-800">
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.length === 0 && !loading ? (
            <p className="px-1 py-4 text-lg text-slate-600">
              {query.trim() ? 'No items match this search.' : 'No active items yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((item) => (
                <li
                  key={item.itemId}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3"
                >
                  <div className="min-w-40 flex-1">
                    <p className="text-xl font-semibold">{item.name}</p>
                    <p className="font-mono text-sm text-slate-500">
                      {item.internalCode}
                      {item.sku ? ` · SKU ${item.sku}` : ''}
                      {item.referenceNumber ? ` · Ref ${item.referenceNumber}` : ''}
                    </p>
                    <p className="text-base text-slate-600">
                      In stock: {item.currentQuantity} {item.unitOfMeasurement}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={selectingId != null}
                    onClick={() => void pick(item)}
                    className="rounded-xl bg-slate-900 px-6 py-3 text-lg font-semibold text-white disabled:opacity-50"
                  >
                    {selectingId === item.itemId ? 'Opening…' : 'Confirm Item'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
