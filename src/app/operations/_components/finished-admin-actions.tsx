'use client';
import { useState } from 'react';
import type { ItemSearchResultView, OperationStateView } from '@/actions/operations';
import type { BarcodeConfirmationView } from '@/actions/scanning';
import { clinicDateTimeInput } from '@/lib/clinic-time';
import { BarcodeCapture, type BarcodeConfirmOutcome, type BarcodeScanSource } from '../../_components/barcode-capture';
import { newClientEventId } from '../../_components/client-event-id';
import { addMissingItemServerAction, editAppliedCostServerAction, editOrTimeServerAction, searchItemsAction } from '../actions';

export function FinishedAdminActions({ state }: { state: OperationStateView }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<ItemSearchResultView[]>([]);
  const [selected, setSelected] = useState<ItemSearchResultView | null>(null); const [amount, setAmount] = useState('1');
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function search() { setBusy(true); const result = await searchItemsAction(query); setResults(result.ok ? result.data : []); if (!result.ok) setMessage(result.error); setBusy(false); }
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
  async function add() { if (!selected) return; const measure = selected.trackingMethod === 'liquid' ? `${amount} ml` : `${amount} units`;
    const numericAmount = Number(amount); const unitCost = Number(selected.appliedCostFormatted?.replace('$', '') ?? '0');
    const calculated = Number.isFinite(numericAmount * unitCost) ? (numericAmount * unitCost).toFixed(2) : '—';
    if (!window.confirm(`Add item to finished surgery?\nCase: ${state.caseCode}\nItem: ${selected.name}\nAmount: ${measure}\nStock deduction: ${measure}\nCalculated cost: $${calculated}`)) return;
    setBusy(true); const result = await addMissingItemServerAction({ operationId: state.id, itemId: selected.itemId,
      quantity: selected.trackingMethod === 'standard' ? Number(amount) : undefined,
      amountUsedMl: selected.trackingMethod === 'liquid' ? amount : undefined, clientEventId: newClientEventId() });
    if (result.ok) { setMessage(result.data.message); window.location.reload(); } else setMessage(result.error); setBusy(false);
  }
  return <div className="mt-4 space-y-5">
    <section className="app-card p-5"><h2 className="text-xl font-semibold">Add Missing Item</h2>
      <div className="mt-3"><BarcodeCapture id="finished-item-scan" label="Scan item barcode" confirmLabel="Select Item" allowPacks={false} disabled={busy} onConfirm={selectScanned} /></div>
      <div className="mt-3 flex gap-2"><input value={query} onChange={e=>setQuery(e.currentTarget.value)} className="min-w-0 flex-1 rounded-xl border px-4 py-3" placeholder="Search item" /><button type="button" onClick={search} className="rounded-xl border px-5">Search</button></div>
      <div className="mt-3 space-y-2">{results.map(item => <button type="button" key={item.itemId} onClick={()=>{setSelected(item);setAmount('1')}} className={`block w-full rounded-xl border p-3 text-left ${selected?.itemId===item.itemId?'border-slate-900 bg-slate-50':''}`}><strong>{item.name}</strong> · {item.trackingMethod === 'liquid' ? `${item.availableMlFormatted} ml available` : `${item.currentQuantity} available`}</button>)}</div>
      {selected ? <div className="mt-3 flex flex-wrap items-end gap-3"><label className="font-semibold">{selected.trackingMethod==='liquid'?'Amount Used (ml)':'Quantity'}<input type="number" min={selected.trackingMethod==='liquid'?'0.01':'1'} step={selected.trackingMethod==='liquid'?'0.01':'1'} value={amount} onChange={e=>setAmount(e.currentTarget.value)} className="mt-1 block rounded-xl border px-4 py-3" /></label><p className="pb-3 text-slate-600">Applied cost: {selected.appliedCostFormatted ?? '$0'} per {selected.trackingMethod === 'liquid' ? 'ml' : 'unit'} · estimated total ${(Number(amount || 0) * Number(selected.appliedCostFormatted?.replace('$', '') ?? 0)).toFixed(2)}</p><button type="button" disabled={busy} onClick={add} className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white">Add to Finished Surgery</button></div> : null}
    </section>
    <section className="app-card p-5"><h2 className="text-xl font-semibold">Edit Applied Cost</h2><div className="mt-3 space-y-3">{state.lines.map(line => <CostEditor key={line.id} operationId={state.id} line={line} />)}</div></section>
    {state.orStartedAtMs && state.orEndedAtMs ? <TimeEditor state={state} /> : null}
    {message ? <p role="status" className="rounded-xl bg-slate-100 p-3">{message}</p> : null}
  </div>;
}

function CostEditor({ operationId, line }: { operationId: number; line: OperationStateView['lines'][number] }) {
  const [cost,setCost]=useState(line.unitCostFormatted?.replace('$','') ?? '0'); const [reason,setReason]=useState(''); const [message,setMessage]=useState('');
  const measure = line.trackingMethod === 'liquid' ? Number(line.amountUsedFormatted ?? 0) : line.quantity;
  const newTotal = Number.isFinite(Number(cost) * measure) ? (Number(cost) * measure).toFixed(2) : '—';
  return <div className="rounded-xl border p-3"><p><strong>{line.name}</strong> · {line.trackingMethod==='liquid'?`${line.amountUsedFormatted} ml`:`${line.quantity} units`}</p><p className="text-slate-600">Current applied cost {line.unitCostFormatted ?? '$0'} per {line.trackingMethod === 'liquid' ? 'ml' : 'unit'} · old total {line.lineTotalFormatted} · new total ${newTotal}</p><div className="mt-2 flex flex-wrap gap-2"><input aria-label="New applied cost" value={cost} onChange={e=>setCost(e.currentTarget.value)} className="w-32 rounded-lg border px-3 py-2" /><input aria-label="Reason" value={reason} onChange={e=>setReason(e.currentTarget.value)} placeholder="Reason (optional)" className="min-w-40 flex-1 rounded-lg border px-3 py-2" /><button type="button" onClick={async()=>{if(!window.confirm(`Change applied cost for ${line.name}?\nOld total: ${line.lineTotalFormatted}\nNew total: $${newTotal}`))return;const r=await editAppliedCostServerAction({operationId,lineId:line.id,cost,reason});if(r.ok)window.location.reload();else setMessage(r.error)}} className="rounded-lg border px-4 font-semibold">Save</button></div>{message?<p className="text-red-700">{message}</p>:null}</div>;
}

function TimeEditor({ state }: { state: OperationStateView }) {
  const [start,setStart]=useState(clinicDateTimeInput(new Date(state.orStartedAtMs!))); const [end,setEnd]=useState(clinicDateTimeInput(new Date(state.orEndedAtMs!))); const [message,setMessage]=useState(''); const [reason,setReason]=useState('');
  return <section className="app-card p-5"><h2 className="text-xl font-semibold">Correct OR Time</h2><p className="mt-1 text-slate-600">Times are entered in Miami time (America/New_York).</p><div className="mt-3 flex flex-wrap gap-3"><label>Start<input type="datetime-local" value={start} onChange={e=>setStart(e.currentTarget.value)} className="block rounded-lg border px-3 py-2" /></label><label>End<input type="datetime-local" value={end} onChange={e=>setEnd(e.currentTarget.value)} className="block rounded-lg border px-3 py-2" /></label><label className="min-w-44 flex-1">Reason (optional)<input value={reason} onChange={e=>setReason(e.currentTarget.value)} className="block w-full rounded-lg border px-3 py-2" /></label><button type="button" onClick={async()=>{const r=await editOrTimeServerAction({operationId:state.id,startedAt:start,endedAt:end,reason});if(r.ok)window.location.reload();else setMessage(r.error)}} className="self-end rounded-lg border px-5 py-2 font-semibold">Save Time</button></div>{message?<p className="text-red-700">{message}</p>:null}</section>;
}
