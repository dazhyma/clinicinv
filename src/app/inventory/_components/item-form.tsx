'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { ItemView } from '@/actions/items';
import { PHOTO_ACCEPT_ATTRIBUTE } from '@/photos/shared';
import { useUnsavedChanges } from '../../_components/use-unsaved-changes';
import type { FormState } from '../actions';
import { ErrorBanner, Field, SubmitButton } from './form-field';
import { ItemPhoto } from '../../_components/item-photo';

const initialState: FormState = {};

export interface ItemFormOptions {
  units: string[];
  categories: string[];
  storageLocations: string[];
}

/**
 * Форма Add New Item (§5.4) и Edit Item (§5.7).
 *
 * Обязательность полей — ровно по §5.4: Item Name, Cost per Unit,
 * Unit of Measurement и Initial Quantity обязательны, всё остальное — нет.
 * Initial Quantity допускает значение 0, поэтому пустое поле и «0» —
 * разные вещи, и валидация их различает.
 *
 * Внутренний код и штрихкод в режиме редактирования выводятся ТЕКСТОМ, а не
 * полем ввода: §5.7 и §18.7 запрещают менять их обычной формой. На сервере то
 * же правило продублировано `IMMUTABLE_ITEM_FIELDS` в доменном `updateItem()`.
 */
export function ItemForm({
  mode,
  action,
  options,
  item,
  unitCostValue,
}: {
  mode: 'create' | 'edit';
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  options: ItemFormOptions;
  item?: ItemView;
  /** Текущая стоимость в долларах строкой; заполняется только для Admin. */
  unitCostValue?: string;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const [dirty, setDirty] = useState(false);
  const fieldErrors = state.fieldErrors ?? {};
  useUnsavedChanges(dirty && !state.ok);

  return (
    <form
      action={formAction}
      onChangeCapture={() => setDirty(true)}
      className="flex flex-col gap-6"
      encType="multipart/form-data"
    >
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}

      <ErrorBanner message={state.error} />

      {item ? (
        <section className="rounded-xl bg-slate-100 px-4 py-3 text-base text-slate-700">
          <p>
            Internal code: <strong className="font-mono">{item.internalCode}</strong>
          </p>
          <p className="mt-1 text-sm text-slate-500">
            The internal code is permanent. The barcode uses SKU when present, or the internal
            code when SKU is empty.
          </p>
        </section>
      ) : null}

      <Field name="name" label="Item Name" required error={fieldErrors.name}>
        {(props) => <input type="text" defaultValue={item?.name ?? ''} autoFocus {...props} />}
      </Field>

      {/* §13: фотография необязательна; при её отсутствии в списке рисуется placeholder. */}
      <div className="flex flex-col gap-2">
        <label htmlFor="photo" className="text-base font-medium">
          Photo <span className="ml-2 text-sm font-normal text-slate-500">optional</span>
        </label>
        <div className="flex items-center gap-4">
          <ItemPhoto photoUrl={item?.photoUrl ?? null} name={item?.name ?? 'New item'} size={72} />
          <div className="flex-1">
            <input
              id="photo"
              name="photo"
              type="file"
              accept={PHOTO_ACCEPT_ATTRIBUTE}
              aria-invalid={fieldErrors.photo ? true : undefined}
              aria-describedby={fieldErrors.photo ? 'photo-error' : 'photo-hint'}
              className="w-full text-base"
            />
            <p id="photo-hint" className="mt-1 text-sm text-slate-500">
              JPG, PNG or WebP. Large images are resized automatically. Do not upload photos
              containing patient information.
            </p>
            {fieldErrors.photo ? (
              <p id="photo-error" role="alert" className="text-base font-medium text-red-700">
                {fieldErrors.photo}
              </p>
            ) : null}
            {item?.photoUrl ? (
              <label className="mt-2 flex items-center gap-2 text-base">
                <input type="checkbox" name="removePhoto" className="h-5 w-5" />
                Remove the current photo
              </label>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          name="sku"
          label="SKU"
          hint="Optional. When present, this value is encoded in the barcode."
          error={fieldErrors.sku}
        >
          {(props) => <input type="text" defaultValue={item?.sku ?? ''} {...props} />}
        </Field>

        <Field
          name="referenceNumber"
          label="Reference / Catalog Number"
          error={fieldErrors.referenceNumber}
        >
          {(props) => <input type="text" defaultValue={item?.referenceNumber ?? ''} {...props} />}
        </Field>

        <Field
          name="costPerUnit"
          label="Cost per Unit"
          required
          hint="Purchase cost, not a sale price."
          error={fieldErrors.costPerUnit}
        >
          {(props) => (
            <input
              type="text"
              inputMode="decimal"
              placeholder="3.25"
              defaultValue={unitCostValue ?? ''}
              {...props}
            />
          )}
        </Field>

        <Field
          name="unitOfMeasurement"
          label="Unit of Measurement"
          required
          hint="Choose a suggestion or type your own."
          error={fieldErrors.unitOfMeasurement}
        >
          {(props) => (
            <>
              <input
                type="text"
                list="unit-options"
                defaultValue={item?.unitOfMeasurement ?? 'each'}
                {...props}
              />
              <datalist id="unit-options">
                {options.units.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        {mode === 'create' ? (
          <Field
            name="initialQuantity"
            label="Initial Quantity"
            required
            hint="May be 0. Later changes go through Receive Stock or an adjustment."
            error={fieldErrors.initialQuantity}
          >
            {(props) => <input type="number" inputMode="numeric" min={0} step={1} defaultValue="0" {...props} />}
          </Field>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-base font-medium">In stock</span>
            <p className="rounded-lg bg-slate-100 px-3 py-3 text-lg">
              {item?.currentQuantity ?? 0} {item?.unitOfMeasurement ?? ''}
            </p>
            <p className="text-sm text-slate-500">
              Stock changes only through Receive Stock, adjustments and operations (§10.4).
            </p>
          </div>
        )}

        <Field name="category" label="Category" error={fieldErrors.category}>
          {(props) => (
            <>
              <input type="text" list="category-options" defaultValue={item?.category ?? ''} {...props} />
              <datalist id="category-options">
                {options.categories.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        <Field name="storageLocation" label="Storage Location" error={fieldErrors.storageLocation}>
          {(props) => (
            <>
              <input
                type="text"
                list="location-options"
                defaultValue={item?.storageLocation ?? ''}
                {...props}
              />
              <datalist id="location-options">
                {options.storageLocations.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        <Field
          name="lowStockThreshold"
          label="Low Stock Threshold"
          hint="The item is highlighted when stock is at or below this number."
          error={fieldErrors.lowStockThreshold}
        >
          {(props) => (
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={item?.lowStockThreshold ?? ''}
              {...props}
            />
          )}
        </Field>

        {mode === 'edit' ? (
          <Field name="status" label="Status" error={fieldErrors.status}>
            {(props) => (
              <select defaultValue={item?.status ?? 'active'} {...props}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            )}
          </Field>
        ) : null}
      </div>

      <Field
        name="notes"
        label="Notes"
        hint="Never enter patient information here."
        error={fieldErrors.notes}
      >
        {(props) => <textarea rows={3} defaultValue={item?.notes ?? ''} {...props} />}
      </Field>

      <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row-reverse sm:justify-start sm:gap-4">
        <SubmitButton>{mode === 'create' ? 'Save Item' : 'Save Changes'}</SubmitButton>
        <Link
          href={item ? `/inventory/items/${item.id}` : '/inventory/catalog'}
          className="rounded-xl border border-slate-300 px-5 py-4 text-center text-lg text-slate-700"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
