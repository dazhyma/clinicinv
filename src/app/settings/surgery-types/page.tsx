import { listSurgeryTypesAction } from '@/actions/surgery-types';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { Card, Select } from '../../_components/ui';
import { createSurgeryTypeFormAction, updateSurgeryTypeFormAction } from './actions';

export const dynamic = 'force-dynamic';
export default async function SurgeryTypesPage() {
  const { account, actor } = await requirePageAdmin();
  const types = listSurgeryTypesAction(getDb(), actor, true);
  return <main className="app-shell max-w-4xl"><AppHeader title="Surgery Types" backHref="/settings" backLabel="Settings"
    account={{ username: account.username, role: account.role }} />
    <Card className="mb-5 p-5"><h2 className="text-xl font-semibold">Add Surgery Type</h2>
      <form action={createSurgeryTypeFormAction} className="mt-4 flex gap-3">
        <input name="name" required maxLength={120} className="min-w-0 flex-1 rounded-xl border px-4 py-3" />
        <button className="rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white">Add</button>
      </form></Card>
    <Card className="p-5"><h2 className="text-xl font-semibold">Saved Types</h2>
      <div className="mt-4 space-y-3">{types.map(type => <form key={type.id} action={updateSurgeryTypeFormAction}
        className="flex flex-wrap gap-3 rounded-xl border p-3"><input type="hidden" name="surgeryTypeId" value={type.id} />
        <input name="name" defaultValue={type.name} required className="min-w-52 flex-1 rounded-lg border px-3 py-2" />
        <Select name="status" defaultValue={type.status}><option value="active">Active</option><option value="inactive">Inactive</option></Select>
        <button className="rounded-lg border px-5 py-2 font-semibold">Save</button></form>)}</div>
    </Card></main>;
}
