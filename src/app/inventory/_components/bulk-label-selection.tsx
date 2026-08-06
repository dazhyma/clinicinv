'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LabelSelectionItemView } from '@/actions/item-labels';
import { LABEL_SIZES } from '@/domain/label-sizes';
import {
  MAX_BULK_LABELS,
  MAX_COPIES_PER_ITEM,
} from '@/domain/label-sheet';
import { ItemPhoto } from '../../_components/item-photo';
import {
  EMPTY_BULK_LABEL_STATE,
  readBulkLabelState,
  writeBulkLabelState,
  type BulkLabelSelectionState,
} from './bulk-label-state';

const ITEMS_PER_PAGE = 50;

function boundedCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_COPIES_PER_ITEM, Math.max(1, Math.trunc(value)));
}

export function BulkLabelSelection({
  items,
  categories,
  storageLocations,
}: {
  items: LabelSelectionItemView[];
  categories: string[];
  storageLocations: string[];
}) {
  const router = useRouter();
  const [state, setState] = useState<BulkLabelSelectionState>(EMPTY_BULK_LABEL_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setState(readBulkLabelState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeBulkLabelState(state);
  }, [hydrated, state]);

  const filtered = useMemo(() => {
    const query = state.filters.query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (
        query &&
        ![item.name, item.internalCode, item.referenceNumber].some((value) =>
          value?.toLocaleLowerCase().includes(query),
        )
      ) {
        return false;
      }
      if (state.filters.category && item.category !== state.filters.category) return false;
      if (state.filters.location && item.storageLocation !== state.filters.location) return false;
      if (state.filters.availability === 'in_stock' && item.currentQuantity <= 0) return false;
      if (state.filters.availability === 'out_of_stock' && item.currentQuantity > 0) return false;
      if (
        state.filters.lowStockOnly &&
        (item.lowStockThreshold == null || item.currentQuantity > item.lowStockThreshold)
      ) {
        return false;
      }
      return true;
    });
  }, [items, state.filters]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);
  const selectedCount = Object.keys(state.selected).length;
  const totalLabels = Object.values(state.selected).reduce((total, copies) => total + copies, 0);

  const setFilter = <K extends keyof BulkLabelSelectionState['filters']>(
    key: K,
    value: BulkLabelSelectionState['filters'][K],
  ) => {
    setPage(1);
    setState((current) => ({
      ...current,
      filters: { ...current.filters, [key]: value },
    }));
  };

  const toggle = (itemId: number) => {
    setState((current) => {
      const selected = { ...current.selected };
      if (selected[itemId]) delete selected[itemId];
      else selected[itemId] = current.defaultCopies;
      return { ...current, selected };
    });
  };

  const selectAll = () => {
    setState((current) => {
      const selected = { ...current.selected };
      for (const item of filtered) selected[item.id] ??= current.defaultCopies;
      return { ...current, selected };
    });
  };

  const createSheet = () => {
    if (selectedCount === 0 || totalLabels > MAX_BULK_LABELS) return;
    writeBulkLabelState(state);
    setGenerating(true);
    router.push('/inventory/labels/preview');
  };

  if (!hydrated) {
    return <p className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">Loading items…</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-sm text-slate-600">Search items</span>
            <input
              type="search"
              value={state.filters.query}
              onChange={(event) => setFilter('query', event.target.value)}
              placeholder="Name, Item Code, reference number"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg"
            />
          </label>
          <FilterSelect
            label="Category"
            value={state.filters.category}
            onChange={(value) => setFilter('category', value)}
            options={categories}
            allLabel="All categories"
          />
          <FilterSelect
            label="Storage location"
            value={state.filters.location}
            onChange={(value) => setFilter('location', value)}
            options={storageLocations}
            allLabel="All locations"
          />
          <label>
            <span className="mb-1 block text-sm text-slate-600">Availability</span>
            <select
              value={state.filters.availability}
              onChange={(event) => setFilter('availability', event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
            >
              <option value="all">Any stock level</option>
              <option value="in_stock">In stock</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-3 self-end">
            <input
              type="checkbox"
              checked={state.filters.lowStockOnly}
              onChange={(event) => setFilter('lowStockOnly', event.target.checked)}
              className="h-6 w-6"
            />
            Low stock only
          </label>
        </div>
      </section>

      {/*
       * Панель действий закреплена вверху: список позиций длинный (при полном
       * складе это десяток страниц), и Create Label Sheet внизу страницы
       * заставлял отматывать до конца после каждого изменения выбора.
       *
       * Счётчик этикеток и предупреждение о лимите держим здесь же: кнопка
       * блокируется именно по нему, и объяснение обязано быть рядом с кнопкой,
       * а не в секции настроек, до которой ещё надо доскроллить (§14.4).
       */}
      <section className="sticky top-2 z-20 rounded-2xl bg-slate-900 p-4 text-white shadow-lg">
        <div className="flex flex-wrap items-center gap-3">
          <span className="mr-auto">
            <strong className="text-xl">
              {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
            </strong>
            <span
              className={`ml-2 ${totalLabels > MAX_BULK_LABELS ? 'font-semibold text-red-300' : 'text-slate-300'}`}
            >
              · {totalLabels.toLocaleString()} labels
              {totalLabels > MAX_BULK_LABELS
                ? ` — reduce to ${MAX_BULK_LABELS.toLocaleString()} or fewer`
                : ''}
            </span>
          </span>
          <button
            type="button"
            onClick={selectAll}
            disabled={filtered.length === 0}
            className="rounded-xl border border-slate-500 px-5 py-3 font-semibold disabled:opacity-50"
          >
            Select All ({filtered.length})
          </button>
          <button
            type="button"
            onClick={() => setState((current) => ({ ...current, selected: {} }))}
            disabled={selectedCount === 0}
            className="rounded-xl border border-slate-500 px-5 py-3 font-semibold disabled:opacity-50"
          >
            Clear Selection
          </button>
          <button
            type="button"
            onClick={createSheet}
            disabled={generating || selectedCount === 0 || totalLabels > MAX_BULK_LABELS}
            className="rounded-xl bg-white px-6 py-3 text-lg font-semibold text-slate-900 disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Create Label Sheet'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <div className="grid gap-4 lg:grid-cols-3">
          <label>
            <span className="mb-1 block font-semibold">Copies per Item</span>
            <input
              type="number"
              min={1}
              max={MAX_COPIES_PER_ITEM}
              value={state.defaultCopies}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  defaultCopies: boundedCopies(Number(event.target.value)),
                }))
              }
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg"
            />
          </label>
          <label>
            <span className="mb-1 block font-semibold">Label Size</span>
            <select
              value={state.sizeId}
              onChange={(event) =>
                setState((current) => ({ ...current, sizeId: event.target.value }))
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg"
            >
              {LABEL_SIZES.map((size) => (
                <option key={size.id} value={size.id}>
                  {size.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col justify-end">
            <button
              type="button"
              onClick={() =>
                setState((current) => ({
                  ...current,
                  selected: Object.fromEntries(
                    Object.keys(current.selected).map((id) => [id, current.defaultCopies]),
                  ),
                }))
              }
              disabled={selectedCount === 0}
              className="rounded-xl border border-slate-300 px-5 py-3 font-semibold disabled:opacity-50"
            >
              Apply Copies to Selected
            </button>
          </div>
        </div>
        <p className={`mt-3 ${totalLabels > MAX_BULK_LABELS ? 'text-red-700' : 'text-slate-600'}`}>
          {totalLabels.toLocaleString()} labels total
          {totalLabels > MAX_BULK_LABELS
            ? ` — reduce the selection to ${MAX_BULK_LABELS.toLocaleString()} labels or fewer`
            : ''}
        </p>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-slate-600">
            {filtered.length} active {filtered.length === 1 ? 'item' : 'items'} match
          </p>
          <PageControls page={safePage} pageCount={pageCount} onPage={setPage} />
        </div>
        {visible.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-slate-600 ring-1 ring-slate-200">
            No active items match these filters.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visible.map((item) => {
              const copies = state.selected[item.id];
              const checked = copies !== undefined;
              return (
                <li
                  key={item.id}
                  role="checkbox"
                  aria-checked={checked}
                  tabIndex={0}
                  onClick={() => toggle(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggle(item.id);
                    }
                  }}
                  className={`flex cursor-pointer flex-wrap items-center gap-4 rounded-2xl p-4 ring-2 transition ${
                    checked ? 'bg-emerald-50 ring-emerald-500' : 'bg-white ring-slate-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggle(item.id)}
                    aria-label={`Select ${item.name}`}
                    className="h-7 w-7 shrink-0"
                  />
                  <ItemPhoto photoUrl={item.photoUrl} name={item.name} size={64} />
                  <div className="min-w-48 flex-1">
                    <p className="text-xl font-semibold">{item.name}</p>
                    <p className="font-mono text-sm text-slate-600">{item.internalCode}</p>
                    <p className="text-sm text-slate-600">
                      {item.referenceNumber ? `Ref ${item.referenceNumber}` : ''}
                    </p>
                    <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-sm text-emerald-800">
                      Active
                    </span>
                  </div>
                  {checked ? (
                    <label
                      className="w-full sm:w-32"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="mb-1 block text-sm font-medium">Copies</span>
                      <input
                        type="number"
                        min={1}
                        max={MAX_COPIES_PER_ITEM}
                        value={copies}
                        onChange={(event) =>
                          setState((current) => ({
                            ...current,
                            selected: {
                              ...current.selected,
                              [item.id]: boundedCopies(Number(event.target.value)),
                            },
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-lg"
                      />
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <PageControls page={safePage} pageCount={pageCount} onPage={setPage} />
        </div>
      </section>

    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function PageControls({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page === 1}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 disabled:opacity-40"
      >
        Previous
      </button>
      <span>
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onPage(Math.min(pageCount, page + 1))}
        disabled={page === pageCount}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
