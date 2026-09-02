'use client';
import { useState } from 'react';
import type { ItemSearchResultView, OperationStateView } from '@/actions/operations';
import type { SurgeryTypeView } from '@/actions/surgery-types';
import type { BarcodeConfirmationView } from '@/actions/scanning';
import { clinicDateTimeInput } from '@/lib/clinic-time';
import { BarcodeCapture, type BarcodeConfirmOutcome, type BarcodeScanSource } from '../../_components/barcode-capture';
import { newClientEventId } from '../../_components/client-event-id';
import { addMissingItemServerAction, editAppliedCostServerAction, editOrTimeServerAction, editSurgeryTypeServerAction, searchItemsAction } from '../actions';

export function FinishedAdminActions({ state, surgeryTypes }: { state: OperationStateView; surgeryTypes: SurgeryTypeView[] }) {
  const [selected, setSelected] = useState<ItemSearchResultView | null>(null);
  const [amount, setAmount] = useState('1');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function selectScanned(candidate: BarcodeConfirmationView, _source: BarcodeScanSource,
    _confirmationId: string, amountUsedMl?: string): Promise<BarcodeConfirmOutcome> {
    if (candidate.kind !== 'item') return { ok: false, error: 'Select an individual item, not a pack' };
    const result = await searchItemsAction(candidate.internalCode);
    if (!result.ok) return { ok: false, error: result.error };
    const item = result.data.find((entry) => entry.itemId === candidate.id);
    if (!item) return { ok: false, error: `${candidate.name} is not available for this surgery` };
    setSelected(item); setAmount(item.trackingMethod === 'liquid' ? amountUsedMl ?? '1.00' : '1');
    return { ok: true, next: 'close', message: `${item.name} selected` };
  }
  async function add() {
    if (!selected) return;
    const measure = selected.trackingMethod === 'liquid' ? `${amount} ml` : `${amount} units`;
    if (!window.confirm(`Add item to finished surgery?\nCase: ${state.caseCode}\nItem: ${selected.name}\nAmount: ${measure}\nStock deduction: ${measure}`)) return;
    setBusy(true);
    const result = await addMissingItemServerAction({ operationId: state.id, itemId: selected.itemId,
      quantity: selected.trackingMethod === 'standard' ? Number(amount) : undefined,
      amountUsedMl: selected.trackingMethod === 'liquid' ? amount : undefined, clientEventId: newClientEventId() });
    if (result.ok) window.location.reload(); else { setMessage(result.error); setBusy(false); }
  }
  return <div className="mt-4 space-y-5">
    <SurgeryTypeEditor state={state} surgeryTypes={surgeryTypes} />
    <section className="app-card p-5"><h2 className="text-xl font-semibold">Add Missing Item</h2>
      <p className="mt-1 text-slate-600">Scan a barcode or search by item name, Item Code, or reference in the same field.</p>
      <div className="mt-3"><BarcodeCapture id="finished-item-scan" label="Search or scan item" confirmLabel="Select Item" allowPacks={false} disabled={busy} onConfirm={selectScanned} /></div>
      {selected ? <div className="mt-3 flex flex-wrap items-end gap-3"><label className="font-semibold">{selected.trackingMethod === 'liquid' ? 'Amount Used (ml)' : 'Quantity'}<input type="number" min={selected.trackingMethod === 'liquid' ? '0.01' : '1'} step={selected.trackingMethod === 'liquid' ? '0.01' : '1'} value={amount} onChange={e => setAmount(e.currentTarget.value)} className="mt-1 block rounded-xl border px-4 py-3" /></label><button type="button" disabled={busy} onClick={add} className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white">Add to Finished Surgery</button></div> : null}
    </section>
    {state.orStartedAtMs && state.orEndedAtMs ? <TimeEditor state={state} /> : null}
    {message ? <p role="status" className="rounded-xl bg-slate-100 p-3">{message}</p> : null}
  </div>;
}

export function CostEditButton({ operationId, line }: { operationId: number; line: OperationStateView['lines'][number] }) {
  const [open, setOpen] = useState(false); const [cost, setCost] = useState(line.unitCostFormatted?.replace('$', '') ?? '0');
  const [reason, setReason] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const measure = line.trackingMethod === 'liquid' ? Number(line.amountUsedFormatted ?? 0) : line.quantity;
  const newTotal = Number.isFinite(Number(cost) * measure) ? (Number(cost) * measure).toFixed(2) : '—';
  async function save() { setBusy(true); const result = await editAppliedCostServerAction({ operationId, lineId: line.id, cost, reason }); if (result.ok) window.location.reload(); else { setMessage(result.error); setBusy(false); } }
  return <><button type="button" onClick={() => setOpen(true)} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold">Edit Cost</button>
    {open ? <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}><section role="dialog" aria-modal="true" aria-labelledby={`cost-title-${line.id}`} className="modal-panel app-card w-full max-w-lg p-6">
      <h2 id={`cost-title-${line.id}`} className="text-2xl font-bold">Edit Applied Cost</h2><p className="mt-3 text-lg font-semibold">{line.name}</p><p className="text-slate-600">Used: {line.trackingMethod === 'liquid' ? `${line.amountUsedFormatted} ml` : `${line.quantity} units`}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><p>Current cost<br /><strong>{line.unitCostFormatted ?? '$0'} / {line.trackingMethod === 'liquid' ? 'ml' : 'unit'}</strong></p><label>New cost per {line.trackingMethod === 'liquid' ? 'ml' : 'unit'}<input autoFocus value={cost} onChange={e => setCost(e.currentTarget.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border px-3 py-2" /></label><p>Old line total<br /><strong>{line.lineTotalFormatted}</strong></p><p>New line total<br /><strong>${newTotal}</strong></p></div>
      <label className="mt-4 block">Reason (optional)<input value={reason} onChange={e => setReason(e.currentTarget.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>{message ? <p className="mt-2 text-red-700">{message}</p> : null}
      <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-5 py-2">Cancel</button><button type="button" disabled={busy} onClick={save} className="rounded-lg bg-slate-900 px-5 py-2 font-semibold text-white">{busy ? 'Saving…' : 'Save'}</button></div>
    </section></div> : null}</>;
}

function SurgeryTypeEditor({ state, surgeryTypes }: { state: OperationStateView; surgeryTypes: SurgeryTypeView[] }) {
  const [value, setValue] = useState(state.surgeryTypeName ?? ''); const [message, setMessage] = useState('');
  return <section className="app-card p-5"><h2 className="text-xl font-semibold">{state.surgeryTypeName ? 'Edit Surgery Type' : 'Add Surgery Type'}</h2><div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-56 flex-1">Choose, enter, or clear the type<input value={value} onChange={e => setValue(e.currentTarget.value)} list="finished-surgery-type-suggestions" maxLength={120} className="mt-1 w-full rounded-xl border px-4 py-3" /><datalist id="finished-surgery-type-suggestions">{surgeryTypes.map(type => <option key={type.id} value={type.name} />)}</datalist></label><button type="button" onClick={async () => { const result = await editSurgeryTypeServerAction({ operationId: state.id, surgeryTypeName: value }); if (result.ok) window.location.reload(); else setMessage(result.error); }} className="rounded-xl border px-5 py-3 font-semibold">Save Surgery Type</button></div>{message ? <p className="mt-2 text-red-700">{message}</p> : null}</section>;
}

function TimeEditor({ state }: { state: OperationStateView }) {
  const [start,setStart]=useState(clinicDateTimeInput(new Date(state.orStartedAtMs!))); const [end,setEnd]=useState(clinicDateTimeInput(new Date(state.orEndedAtMs!))); const [message,setMessage]=useState(''); const [reason,setReason]=useState('');
  return <section className="app-card p-5"><h2 className="text-xl font-semibold">Correct OR Time</h2><p className="mt-1 text-slate-600">Times are entered in Miami time (America/New_York).</p><div className="mt-3 flex flex-wrap gap-3"><label>Start<input type="datetime-local" value={start} onChange={e=>setStart(e.currentTarget.value)} className="block rounded-lg border px-3 py-2" /></label><label>End<input type="datetime-local" value={end} onChange={e=>setEnd(e.currentTarget.value)} className="block rounded-lg border px-3 py-2" /></label><label className="min-w-44 flex-1">Reason (optional)<input value={reason} onChange={e=>setReason(e.currentTarget.value)} className="block w-full rounded-lg border px-3 py-2" /></label><button type="button" onClick={async()=>{const r=await editOrTimeServerAction({operationId:state.id,startedAt:start,endedAt:end,reason});if(r.ok)window.location.reload();else setMessage(r.error)}} className="self-end rounded-lg border px-5 py-2 font-semibold">Save Time</button></div>{message?<p className="text-red-700">{message}</p>:null}</section>;
}
