import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import { doctors, operationItems, operations, surgeryTypes, userAccounts } from '@/db/schema';
import { decryptPatientId } from '@/security/patient-id';
import { clinicDate, clinicLocalToUtc, CLINIC_TIME_ZONE } from '@/lib/clinic-time';

export const dynamic = 'force-dynamic';
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function reportRange(search: URLSearchParams): [string, string] {
  const period = search.get('period') ?? 'day'; const chosen = search.get('dateFrom') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chosen)) throw new Error('Select a valid report date');
  if (period === 'custom') { const to = search.get('dateTo') ?? ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to < chosen) throw new Error('Select a valid custom date range'); return [chosen, to]; }
  if (period === 'week') { const day = new Date(`${chosen}T12:00:00Z`).getUTCDay(); const from = addDays(chosen, -(day === 0 ? 6 : day - 1)); return [from, addDays(from, 6)]; }
  if (period === 'month') { const [year, month] = chosen.split('-').map(Number); const from = `${year}-${String(month).padStart(2, '0')}-01`; const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate(); return [from, `${year}-${String(month).padStart(2, '0')}-${last}`]; }
  return [chosen, chosen];
}
function excelClinicTimestamp(value: Date | null): Date | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CLINIC_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day),
    Number(fields.hour), Number(fields.minute), Number(fields.second)));
}
function duration(start: Date | null, end: Date | null): string {
  if (!start || !end) return '';
  const total = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function styleSheet(sheet: ExcelJS.Worksheet, widths: number[]) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(widths.length).address };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F3E46' } };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

export async function GET(request: Request): Promise<Response> {
  const actor = await requireActor();
  if (actor.role !== 'Admin') return new Response('Reports are available only to Admin.', { status: 403 });
  try {
    const url = new URL(request.url); const [from, to] = reportRange(url.searchParams);
    const doctorIds = new Set(url.searchParams.getAll('doctorIds').filter(v => v !== 'all').map(Number));
    const typeIds = new Set(url.searchParams.getAll('surgeryTypeIds').filter(v => v !== 'all').map(Number));
    const start = clinicLocalToUtc(from); const end = clinicLocalToUtc(to, true); const db = getDb();
    const rows = db.select().from(operations).where(eq(operations.status, 'Finished')).all().filter(operation =>
      operation.finishedAt && operation.finishedAt >= start && operation.finishedAt <= end &&
      (doctorIds.size === 0 || (operation.doctorId != null && doctorIds.has(operation.doctorId))) &&
      (typeIds.size === 0 || (operation.surgeryTypeId != null && typeIds.has(operation.surgeryTypeId))));
    const ids = new Set(rows.map(row => row.id));
    const lines = db.select().from(operationItems).all().filter(line => ids.has(line.operationId));
    const accountNames = new Map(db.select({ id: userAccounts.id, username: userAccounts.username }).from(userAccounts).all().map(a => [a.id, a.username]));
    const workbook = new ExcelJS.Workbook(); workbook.creator = 'Clinic Inventory'; workbook.created = new Date();
    const doctorNames = new Map(db.select({ id: doctors.id, name: doctors.lastName }).from(doctors).all().map(row => [row.id, row.name]));
    const typeNames = new Map(db.select({ id: surgeryTypes.id, name: surgeryTypes.name }).from(surgeryTypes).all().map(row => [row.id, row.name]));
    const summary = workbook.addWorksheet('Summary');
    summary.addRow(['Report Period', `${from} to ${to}`]); summary.addRow(['Selected Doctors', doctorIds.size ? [...doctorIds].map(id => doctorNames.get(id) ?? `#${id}`).join(', ') : 'All Doctors']);
    summary.addRow(['Selected Surgery Types', typeIds.size ? [...typeIds].map(id => typeNames.get(id) ?? `#${id}`).join(', ') : 'All Surgery Types']);
    summary.addRow(['Total Number of Surgeries', rows.length]); summary.addRow(['Total Cost of Used Items', rows.reduce((sum, row) => sum + (row.totalCostSnapshotCents ?? 0), 0) / 100]);
    summary.getCell('B5').numFmt = '$#,##0.00'; summary.addRow([]); summary.addRow(['Doctor', 'Surgeries', 'Used Items Cost']);
    const byDoctor = new Map<string, { count: number; cost: number }>(); const byType = new Map<string, { count: number; cost: number }>();
    for (const row of rows) { const doctor = row.doctorNameSnapshot ?? 'Not provided'; const type = row.surgeryTypeNameSnapshot ?? 'Not provided';
      const cost = (row.totalCostSnapshotCents ?? 0) / 100; const d = byDoctor.get(doctor) ?? { count: 0, cost: 0 }; d.count++; d.cost += cost; byDoctor.set(doctor, d);
      const t = byType.get(type) ?? { count: 0, cost: 0 }; t.count++; t.cost += cost; byType.set(type, t); }
    byDoctor.forEach((value, name) => { const added = summary.addRow([name, value.count, value.cost]); added.getCell(3).numFmt = '$#,##0.00'; });
    summary.addRow([]); summary.addRow(['Surgery Type', 'Surgeries', 'Used Items Cost']); byType.forEach((value, name) => { const added = summary.addRow([name, value.count, value.cost]); added.getCell(3).numFmt = '$#,##0.00'; });
    summary.columns = [{ width: 30 }, { width: 24 }, { width: 22 }];

    const details = workbook.addWorksheet('Surgery Details'); details.addRow(['Date', 'Case Code', 'Patient ID', 'Doctor', 'Surgery Type', 'OR Start Time', 'OR End Time', 'OR Duration', 'Total Cost of Used Items', 'Finished By']);
    for (const row of rows) { const date = clinicDate(row.finishedAt!); const [y,m,d] = date.split('-').map(Number); const added = details.addRow([new Date(Date.UTC(y!,m!-1,d!)), row.caseCode ?? row.randomCaseCode,
      row.patientIdEncrypted ? decryptPatientId(row.patientIdEncrypted) : 'Not provided', row.doctorNameSnapshot ?? 'Not provided', row.surgeryTypeNameSnapshot ?? 'Not provided', excelClinicTimestamp(row.orStartedAt), excelClinicTimestamp(row.orEndedAt), duration(row.orStartedAt, row.orEndedAt), (row.totalCostSnapshotCents ?? 0) / 100, row.finishedByAccountId ? accountNames.get(row.finishedByAccountId) ?? 'Unknown' : 'Unknown']);
      added.getCell(1).numFmt = 'mm/dd/yyyy'; added.getCell(6).numFmt = 'mm/dd/yyyy hh:mm';
      added.getCell(7).numFmt = 'mm/dd/yyyy hh:mm'; added.getCell(9).numFmt = '$#,##0.00'; }
    styleSheet(details, [13, 16, 16, 20, 24, 24, 24, 14, 24, 18]);

    const usage = workbook.addWorksheet('Item Usage'); usage.addRow(['Date','Case Code','Patient ID','Doctor','Surgery Type','Item Code','Item Name','Manufacturer','Tracking Method','Quantity Used','Measurement Unit','Applied Cost per Unit/ml','Line Total']);
    const rowById = new Map(rows.map(row => [row.id, row]));
    for (const line of lines) { const operation = rowById.get(line.operationId)!; const date = clinicDate(operation.finishedAt!); const [y,m,d] = date.split('-').map(Number);
      const measureCost = (line.appliedCostPerMeasureMicros ?? line.unitCostSnapshotCents * 10000) / 1_000_000;
      const added = usage.addRow([new Date(Date.UTC(y!,m!-1,d!)), operation.caseCode ?? operation.randomCaseCode, operation.patientIdEncrypted ? decryptPatientId(operation.patientIdEncrypted) : 'Not provided', operation.doctorNameSnapshot ?? 'Not provided', operation.surgeryTypeNameSnapshot ?? 'Not provided', line.internalCodeSnapshot, line.itemNameSnapshot, line.manufacturerNameSnapshot ?? 'Not provided', line.trackingMethodSnapshot === 'liquid' ? 'Liquid Volume' : 'Standard Units', line.trackingMethodSnapshot === 'liquid' ? (line.amountUsedCentiml ?? 0) / 100 : line.quantity, line.trackingMethodSnapshot === 'liquid' ? 'ml' : line.unitOfMeasurementSnapshot, measureCost, line.lineTotalCents / 100]);
      added.getCell(1).numFmt='mm/dd/yyyy'; added.getCell(10).numFmt='0.00'; added.getCell(12).numFmt='$#,##0.0000'; added.getCell(13).numFmt='$#,##0.00'; }
    styleSheet(usage, [13,16,16,20,24,16,30,22,18,16,18,24,16]);
    const buffer = await workbook.xlsx.writeBuffer(); const filename = `Surgery_Report_${from}_to_${to}.xlsx`;
    return new Response(new Uint8Array(buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
  } catch (error) { return new Response(error instanceof Error ? error.message : 'Report could not be generated', { status: 400 }); }
}
