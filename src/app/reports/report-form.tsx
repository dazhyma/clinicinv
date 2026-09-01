'use client';
import { useState } from 'react';
import type { DoctorView } from '@/actions/doctors';
import type { SurgeryTypeView } from '@/actions/surgery-types';
import { BASE_PATH } from '@/base-path';
import { Select } from '../_components/ui';

export function ReportForm({ doctors, surgeryTypes }: { doctors: DoctorView[]; surgeryTypes: SurgeryTypeView[] }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const [period, setPeriod] = useState('day');
  return <form method="get" action={`${BASE_PATH}/api/reports/surgeries`} className="app-card flex flex-col gap-5 p-5">
    <label className="font-semibold">Period
      <Select name="period" value={period} onChange={event => setPeriod(event.currentTarget.value)} className="mt-1 w-full">
        <option value="day">Single Day</option><option value="week">Week</option><option value="month">Month</option><option value="custom">Custom Date Range</option>
      </Select></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="font-semibold">{period === 'custom' ? 'From' : 'Date'}<input name="dateFrom" type="date" defaultValue={today} required className="mt-1 w-full rounded-xl border px-4 py-3" /></label>
      {period === 'custom' ? <label className="font-semibold">To<input name="dateTo" type="date" defaultValue={today} required className="mt-1 w-full rounded-xl border px-4 py-3" /></label> : null}
    </div>
    <fieldset className="rounded-xl border p-4"><legend className="px-2 font-semibold">Doctors</legend><p className="mb-2 text-sm text-slate-600">Leave all unchecked to include all doctors.</p><div className="grid gap-2 sm:grid-cols-2">{doctors.map(d => <label key={d.id} className="flex items-center gap-2"><input type="checkbox" name="doctorIds" value={d.id} className="h-5 w-5" />{d.lastName}</label>)}</div></fieldset>
    <fieldset className="rounded-xl border p-4"><legend className="px-2 font-semibold">Surgery Types</legend><p className="mb-2 text-sm text-slate-600">Leave all unchecked to include all types.</p><div className="grid gap-2 sm:grid-cols-2">{surgeryTypes.map(t => <label key={t.id} className="flex items-center gap-2"><input type="checkbox" name="surgeryTypeIds" value={t.id} className="h-5 w-5" />{t.name}</label>)}</div></fieldset>
    <button className="rounded-xl bg-slate-900 px-7 py-4 text-lg font-semibold text-white">Generate Excel Report</button>
  </form>;
}
