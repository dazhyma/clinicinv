import { listDoctorsAction } from '@/actions/doctors';
import { listSurgeryTypesAction } from '@/actions/surgery-types';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../_components/app-header';
import { ReportForm } from './report-form';
export const dynamic = 'force-dynamic';
export default async function ReportsPage() {
  const { account, actor } = await requirePageAdmin(); const db = getDb();
  return <main className="app-shell max-w-4xl"><AppHeader title="Reports" backHref="/" backLabel="Home" account={{ username: account.username, role: account.role }} />
    <ReportForm doctors={listDoctorsAction(db, actor, { includeArchived: true })} surgeryTypes={listSurgeryTypesAction(db, actor, true)} /></main>;
}
