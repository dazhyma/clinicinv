'use client';

import { useRef } from 'react';
import { withBasePath } from '@/base-path';

/**
 * Поиск и фильтры списка предметов (§5.3).
 *
 * Это обычная GET-форма: состояние живёт в адресной строке, поэтому результат
 * переживает обновление страницы, ссылку можно передать коллеге, а без
 * JavaScript поиск всё равно работает. Выпадающие списки отправляют форму сами,
 * чтобы на планшете не приходилось искать кнопку.
 */
export function ItemFilters({
  categories,
  storageLocations,
  values,
  isAdmin,
  lowStockCount,
}: {
  categories: string[];
  storageLocations: string[];
  values: {
    q: string;
    category: string;
    location: string;
    availability: string;
    lowStock: boolean;
    includeInactive: boolean;
  };
  isAdmin: boolean;
  lowStockCount: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  const selectClass =
    'min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base';

  return (
    // Обычная GET-форма: атрибут action отправляет браузер, Next префикс сюда
    // не подставляет — его дописывает withBasePath (D-51).
    <form
      ref={formRef}
      method="get"
      action={withBasePath('/inventory')}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="q" className="sr-only">
            Search items by name, internal code, SKU or reference number
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={values.q}
            placeholder="Search name, internal code, SKU, reference number"
            className="w-full rounded-lg border border-slate-300 px-4 py-3 text-lg"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-6 py-3 text-lg font-semibold text-white"
        >
          Search
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="category" className="mb-1 block text-sm text-slate-600">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={values.category}
            onChange={submit}
            className={selectClass}
          >
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="location" className="mb-1 block text-sm text-slate-600">
            Storage location
          </label>
          <select
            id="location"
            name="location"
            defaultValue={values.location}
            onChange={submit}
            className={selectClass}
          >
            <option value="">All locations</option>
            {storageLocations.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="availability" className="mb-1 block text-sm text-slate-600">
            Availability
          </label>
          <select
            id="availability"
            name="availability"
            defaultValue={values.availability}
            onChange={submit}
            className={selectClass}
          >
            <option value="all">Any stock level</option>
            <option value="in_stock">In stock</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {/* §5.11: отдельный фильтр Low Stock. */}
        <label className="flex min-h-12 items-center gap-2 text-base">
          <input
            type="checkbox"
            name="lowStock"
            value="1"
            defaultChecked={values.lowStock}
            onChange={submit}
            className="h-5 w-5"
          />
          Low stock only
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-sm text-amber-900">
            {lowStockCount}
          </span>
        </label>

        {isAdmin ? (
          <label className="flex min-h-12 items-center gap-2 text-base">
            <input
              type="checkbox"
              name="includeInactive"
              value="1"
              defaultChecked={values.includeInactive}
              onChange={submit}
              className="h-5 w-5"
            />
            Include inactive items
          </label>
        ) : null}
      </div>
    </form>
  );
}
