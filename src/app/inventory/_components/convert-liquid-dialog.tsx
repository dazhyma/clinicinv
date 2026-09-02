'use client';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ItemView } from '@/actions/items';
import { convertItemToLiquidFormAction, type FormState } from '../actions';

const initialState: FormState = {};

export function ConvertLiquidDialog({ item }: { item: ItemView }) {
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState('');
  const [cost, setCost] = useState(item.unitCostFormatted?.replace('$', '') ?? '0.00');
  const [state, action] = useActionState(convertItemToLiquidFormAction, initialState);
  const volumeNumber = Number(volume);
  const costNumber = Number(cost);
  const totalMl = Number.isFinite(volumeNumber) ? item.currentQuantity * volumeNumber : 0;
  const costPerMl = volumeNumber > 0 && Number.isFinite(costNumber) ? costNumber / volumeNumber : 0;
  useEffect(() => { if (state.ok) window.location.reload(); }, [state.ok]);
  return <><button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold">Convert to Liquid Volume (ml)</button>
    {open ? <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby="convert-liquid-title" className="modal-panel app-card w-full max-w-xl p-6">
      <h2 id="convert-liquid-title" className="text-2xl font-bold">Convert to Liquid Volume (ml)</h2>
      <p className="mt-2 text-slate-700">This one-way action keeps the same item and barcode. Current units become unopened vials.</p>
      <form action={action} className="mt-4 space-y-4"><input type="hidden" name="itemId" value={item.id} />
        <label className="block font-semibold">Volume per vial (ml)<input required name="volumePerVialMl" value={volume} onChange={e => setVolume(e.currentTarget.value)} type="number" min="0.01" step="0.01" className="mt-1 w-full rounded-xl border px-4 py-3" /></label>
        <label className="block font-semibold">Cost per vial<input required name="costPerVial" value={cost} onChange={e => setCost(e.currentTarget.value)} type="number" min="0" step="0.01" className="mt-1 w-full rounded-xl border px-4 py-3" /></label>
        <div className="rounded-xl bg-slate-100 p-4"><h3 className="font-semibold">Preview</h3><p>Current stock: {item.currentQuantity} units → <strong>{item.currentQuantity} unopened vials</strong></p><p>Total volume: <strong>{totalMl.toLocaleString(undefined, { maximumFractionDigits: 2 })} ml</strong></p><p>Cost per vial: <strong>${Number.isFinite(costNumber) ? costNumber.toFixed(2) : '—'}</strong></p><p>Cost per ml: <strong>{volumeNumber > 0 ? `$${costPerMl.toFixed(4)}` : '—'}</strong></p></div>
        {state.error ? <p className="text-red-700">{state.error}</p> : null}
        <div className="flex justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="rounded-xl border px-5 py-3">Cancel</button><SubmitButton /></div>
      </form>
    </section></div> : null}</>;
}

function SubmitButton() { const { pending } = useFormStatus(); return <button type="submit" disabled={pending} className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white">{pending ? 'Converting…' : 'Convert Item'}</button>; }
