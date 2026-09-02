'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { ItemView } from '@/actions/items';
import { formatCentiml } from '@/domain/liquid';
import { useUnsavedChanges } from '../../_components/use-unsaved-changes';
import type { FormState } from '../actions';
import { ErrorBanner, Field, SubmitButton } from './form-field';
import { Select } from '../../_components/ui';

const initialState: FormState = {};

export interface ItemFormOptions {
  units: string[];
  categories: string[];
  storageLocations: string[];
  manufacturers: { id: number; name: string }[];
}

/** Tracking method фиксируется при создании: конвертация stock между моделями запрещена. */
export function ItemForm({ mode, action, options, item, unitCostValue }: {
  mode: 'create' | 'edit';
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  options: ItemFormOptions;
  item?: ItemView;
  unitCostValue?: string;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const [dirty, setDirty] = useState(false);
  const [trackingMethod, setTrackingMethod] = useState<'standard' | 'liquid'>(item?.trackingMethod ?? 'standard');
  const fieldErrors = state.fieldErrors ?? {};
  useUnsavedChanges(dirty && !state.ok);
  const liquid = trackingMethod === 'liquid';

  return (
    <form action={formAction} onChangeCapture={() => setDirty(true)} className="flex flex-col gap-6">
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}
      {mode === 'edit' ? <input type="hidden" name="trackingMethod" value={trackingMethod} /> : null}
      {mode === 'edit' && liquid && item?.liquidVolumePerVialCentiml ? (
        <input type="hidden" name="volumePerVialMl" value={formatCentiml(item.liquidVolumePerVialCentiml)} />
      ) : null}

      <ErrorBanner message={state.error} />
      {item ? (
        <section className="rounded-xl bg-slate-100 px-4 py-3 text-base text-slate-700">
          <p>Item Code: <strong className="font-mono">{item.internalCode}</strong></p>
          <p className="mt-1 text-sm text-slate-500">The Item Code and barcode are permanent. Tracking method cannot be changed from this form.</p>
        </section>
      ) : null}

      <Field name="trackingMethod" label="Inventory Tracking Method" required error={fieldErrors.trackingMethod}>
        {(props) => mode === 'create' ? (
          <Select value={trackingMethod} onChange={(event) => setTrackingMethod(event.target.value as 'standard' | 'liquid')} {...props}>
            <option value="standard">Standard Units</option>
            <option value="liquid">Liquid Volume (ml)</option>
          </Select>
        ) : <p className="rounded-lg bg-slate-100 px-3 py-3 text-lg">{liquid ? 'Liquid Volume (ml)' : 'Standard Units'}</p>}
      </Field>

      <Field name="name" label="Item Name" required error={fieldErrors.name}>
        {(props) => <input type="text" defaultValue={item?.name ?? ''} autoFocus {...props} />}
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field name="manufacturer" label="Manufacturer" error={fieldErrors.manufacturer} hint="Choose a saved name or enter a new one.">
          {(props) => <><input type="text" list="manufacturer-options" defaultValue={item?.manufacturer ?? ''} {...props} /><datalist id="manufacturer-options">{options.manufacturers.map((value) => <option key={value.id} value={value.name} />)}</datalist></>}
        </Field>
        <Field name="referenceNumber" label="Reference / Catalog Number" error={fieldErrors.referenceNumber}>
          {(props) => <input type="text" defaultValue={item?.referenceNumber ?? ''} {...props} />}
        </Field>

        {liquid ? (
          <Field name="volumePerVialMl" label="Volume per Vial (ml)" required error={fieldErrors.volumePerVialMl}>
            {(props) => mode === 'create' ? <input type="number" inputMode="decimal" min="0.01" step="0.01" {...props} /> : <p className="rounded-lg bg-slate-100 px-3 py-3 text-lg">{item?.liquidVolumePerVialCentiml ? formatCentiml(item.liquidVolumePerVialCentiml) : '—'} ml</p>}
          </Field>
        ) : (
          <Field name="unitOfMeasurement" label="Unit of Measurement" required error={fieldErrors.unitOfMeasurement}>
            {(props) => <><input type="text" list="unit-options" defaultValue={item?.unitOfMeasurement ?? 'each'} {...props} /><datalist id="unit-options">{options.units.map((unit) => <option key={unit} value={unit} />)}</datalist></>}
          </Field>
        )}

        <Field name="costPerUnit" label={liquid ? 'Cost per Vial' : 'Cost per Unit'} required hint={liquid ? 'Cost per ml is calculated automatically.' : 'Purchase cost, not a sale price.'} error={fieldErrors.costPerUnit}>
          {(props) => <input type="text" inputMode="decimal" placeholder="3.25" defaultValue={unitCostValue ?? ''} {...props} />}
        </Field>

        {mode === 'create' && liquid ? <>
          <Field name="initialUnopenedVials" label="Number of Vials" required error={fieldErrors.initialUnopenedVials}>{(props) => <input type="number" inputMode="numeric" min={0} step={1} defaultValue="0" {...props} />}</Field>
          <Field name="initialOpenVialMl" label="Remaining ml in Open Vial" error={fieldErrors.initialOpenVialMl} hint="Leave empty if there is no open vial.">{(props) => <input type="number" inputMode="decimal" min="0" step="0.01" {...props} />}</Field>
        </> : mode === 'create' ? (
          <Field name="initialQuantity" label="Initial Quantity" required error={fieldErrors.initialQuantity}>{(props) => <input type="number" inputMode="numeric" min={0} step={1} defaultValue="0" {...props} />}</Field>
        ) : (
          <div className="flex flex-col gap-1"><span className="text-base font-medium">In stock</span><p className="rounded-lg bg-slate-100 px-3 py-3 text-lg">{liquid ? `${item?.liquidTotalFormatted ?? '0.00'} ml · ${item?.liquidUnopenedVials ?? 0} unopened vials` : `${item?.currentQuantity ?? 0} ${item?.unitOfMeasurement ?? ''}`}</p></div>
        )}

        <Field name="category" label="Category" error={fieldErrors.category}>{(props) => <><input type="text" list="category-options" defaultValue={item?.category ?? ''} {...props} /><datalist id="category-options">{options.categories.map((value) => <option key={value} value={value} />)}</datalist></>}</Field>
        <Field name="storageLocation" label="Storage Location" error={fieldErrors.storageLocation}>{(props) => <><input type="text" list="location-options" defaultValue={item?.storageLocation ?? ''} {...props} /><datalist id="location-options">{options.storageLocations.map((value) => <option key={value} value={value} />)}</datalist></>}</Field>
        {!liquid ? <Field name="lowStockThreshold" label="Low Stock Threshold" error={fieldErrors.lowStockThreshold}>{(props) => <input type="number" inputMode="numeric" min={0} step={1} defaultValue={item?.lowStockThreshold ?? ''} {...props} />}</Field> : null}
        {mode === 'edit' ? <Field name="status" label="Status" error={fieldErrors.status}>{(props) => <Select defaultValue={item?.status ?? 'active'} {...props}><option value="active">Active</option><option value="inactive">Inactive</option></Select>}</Field> : null}
      </div>

      <Field name="notes" label="Notes" hint="Never enter patient information here." error={fieldErrors.notes}>{(props) => <textarea rows={3} defaultValue={item?.notes ?? ''} {...props} />}</Field>
      <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row-reverse sm:justify-start sm:gap-4">
        <SubmitButton>{mode === 'create' ? 'Save Item' : 'Save Changes'}</SubmitButton>
        <Link href={item ? `/inventory/items/${item.id}` : '/inventory/catalog'} className="rounded-xl border border-slate-300 px-5 py-4 text-center text-lg text-slate-700">Cancel</Link>
      </div>
    </form>
  );
}
