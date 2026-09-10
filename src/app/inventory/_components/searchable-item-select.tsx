'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { ItemView } from '@/actions/items';
import { normalizeSearchCode } from '@/lib/search-normalization';

const RESULT_LIMIT = 50;

interface SearchableItemSelectProps {
  id: string;
  name: string;
  items: ItemView[];
  value: string;
  excludedIds: Set<string>;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}

export interface IndexedItem {
  item: ItemView;
  words: string;
  normalized: string;
}

export function indexPackItems(items: ItemView[]): IndexedItem[] {
  return items.map((item) => ({
    item,
    words: [item.name, item.internalCode, item.referenceNumber, item.manufacturer, item.barcodeValue]
      .filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase('en-US'),
    normalized: normalizeSearchCode(
      [item.name, item.internalCode, item.referenceNumber, item.manufacturer, item.barcodeValue]
        .filter(Boolean).join(' '),
    ),
  }));
}

function itemLabel(item: ItemView): string {
  return `${item.name} · ${item.internalCode}`;
}

export function filterPackItems(
  indexed: IndexedItem[],
  query: string,
  excludedIds: Set<string>,
  currentValue: string,
): ItemView[] {
  const words = query.normalize('NFKC').trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  const normalized = normalizeSearchCode(query);
  return indexed
    .filter(({ item }) => String(item.id) === currentValue || !excludedIds.has(String(item.id)))
    .filter((entry) => words.length === 0 ||
      words.every((word) => entry.words.includes(word)) ||
      (normalized.length > 0 && entry.normalized.includes(normalized)))
    .slice(0, RESULT_LIMIT)
    .map(({ item }) => item);
}

/** Независимый searchable selector для каждой строки состава Pack. */
export function SearchableItemSelect({
  id,
  name,
  items,
  value,
  excludedIds,
  onChange,
  invalid,
  describedBy,
}: SearchableItemSelectProps) {
  const selected = items.find((item) => String(item.id) === value);
  const [query, setQuery] = useState(selected ? itemLabel(selected) : '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = `${id}-listbox`;

  const indexed = useMemo(() => indexPackItems(items), [items]);

  const results = useMemo(
    () => filterPackItems(indexed, query, excludedIds, value),
    [excludedIds, indexed, query, value],
  );

  useEffect(() => {
    if (!open) setQuery(selected ? itemLabel(selected) : '');
  }, [open, selected]);

  function positionMenu() {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const edge = 8;
    const gap = 6;
    const desiredHeight = 320;
    const below = window.innerHeight - rect.bottom - edge - gap;
    const above = rect.top - edge - gap;
    const opensAbove = below < 180 && above > below;
    const maxHeight = Math.max(120, Math.min(desiredHeight, opensAbove ? above : below));
    const width = Math.min(Math.max(rect.width, 360), window.innerWidth - edge * 2);
    const left = Math.min(Math.max(edge, rect.left), window.innerWidth - edge - width);
    setMenuStyle({ position: 'fixed', left, width, maxHeight,
      ...(opensAbove ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }) });
  }

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const reposition = () => positionMenu();
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!inputRef.current?.parentElement?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', closeOutside);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', closeOutside);
    };
  }, [open]);

  useEffect(() => {
    if (!open || results.length === 0) return;
    const next = Math.min(activeIndex, results.length - 1);
    if (next !== activeIndex) setActiveIndex(next);
    const menu = menuRef.current;
    const option = optionRefs.current[next];
    if (!menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
  }, [activeIndex, open, results]);

  function choose(item: ItemView) {
    onChange(String(item.id));
    setQuery(itemLabel(item));
    setOpen(false);
    inputRef.current?.focus({ preventScroll: true });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); setActiveIndex(0); return; }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + direction + results.length) % Math.max(results.length, 1));
    } else if (event.key === 'Enter' && open && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return <div className="relative">
    <input type="hidden" name={name} value={value} />
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open && results[activeIndex] ? `${listboxId}-option-${results[activeIndex]!.id}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={query}
        placeholder="Search by item name or code..."
        autoComplete="off"
        className={`w-full rounded-lg border py-3 pr-10 pl-3 text-lg ${invalid ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-white'}`}
        onFocus={() => { setQuery(''); setOpen(true); setActiveIndex(0); }}
        onBlur={() => setOpen(false)}
        onChange={(event) => { setQuery(event.currentTarget.value); if (value) onChange(''); setOpen(true); setActiveIndex(0); }}
        onKeyDown={handleKeyDown}
      />
      {query ? <button type="button" aria-label="Clear item search" className="absolute inset-y-0 right-0 px-3 text-xl text-slate-500" onClick={() => { setQuery(''); if (value) onChange(''); setOpen(true); inputRef.current?.focus({ preventScroll: true }); }}>×</button> : null}
    </div>
    {open && typeof document !== 'undefined' ? createPortal(
      <div ref={menuRef} id={listboxId} role="listbox" aria-label="Items" style={menuStyle} className="z-[80] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
        {results.length === 0 ? <p className="px-4 py-4 text-slate-600">No items found.</p> : results.map((item, index) =>
          <button
            key={item.id}
            ref={(node) => { optionRefs.current[index] = node; }}
            id={`${listboxId}-option-${item.id}`}
            type="button"
            role="option"
            aria-selected={String(item.id) === value}
            className={`block w-full rounded-lg px-3 py-2 text-left ${index === activeIndex ? 'bg-slate-100' : 'bg-white'}`}
            onPointerMove={() => setActiveIndex(index)}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(item)}
          >
            <strong className="block text-base text-slate-950">{item.name}</strong>
            <span className="block text-sm text-slate-600"><span className="font-mono">{item.internalCode}</span>{item.referenceNumber ? ` · Ref: ${item.referenceNumber}` : ''}{item.manufacturer ? ` · ${item.manufacturer}` : ''}</span>
          </button>)}
      </div>,
      document.body,
    ) : null}
  </div>;
}
