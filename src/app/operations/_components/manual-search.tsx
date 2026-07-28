'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItemSearchResultView } from '@/actions/operations';
import { searchItemsAction } from '../actions';

/**
 * Manual Item Search (§7.8).
 *
 * Нужен, когда штрихкод повреждён или сканер не работает, поэтому поиск идёт по
 * названию, внутреннему коду, SKU и reference/catalog number — тем же четырём
 * атрибутам, что и в разделе Inventory (§5.3).
 *
 * Выбор предмета добавляет его в операцию по ТОЙ ЖЕ логике, что и скан: то же
 * действие, то же движение остатка, тот же снимок стоимости (§7.8). Диалог
 * закрывается сразу, и фокус возвращается в поле сканирования (§7.5) — за это
 * отвечает вызывающий экран.
 */
export function ManualSearchDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: ItemSearchResultView) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemSearchResultView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    // Небольшая задержка: поиск идёт по каждому символу, но без неё каждое
    // нажатие уходило бы на сервер отдельным запросом.
    const timer = setTimeout(async () => {
      try {
        const result = await searchItemsAction(query);
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
          setError('Search is not available — check connection');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-slate-900/60 p-3 sm:p-6"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manual Item Search"
        className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-2xl bg-white p-4 shadow-xl sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Manual Item Search</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
          >
            Close
          </button>
        </div>

        <label htmlFor="manual-search" className="sr-only">
          Search by name, internal code, SKU or reference number
        </label>
        <input
          id="manual-search"
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
              {query.trim() ? 'No items match this search.' : 'No items yet.'}
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
                      {item.unitCostFormatted ? ` · ${item.unitCostFormatted}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onPick(item)}
                    className="rounded-xl bg-slate-900 px-6 py-3 text-lg font-semibold text-white"
                  >
                    Add
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
