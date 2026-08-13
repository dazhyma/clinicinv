/**
 * Журнал критических системных действий (§15; C-14, Q-18 — сущности в §17 нет).
 *
 * Записи журнала НЕ содержат пациентских данных (§15, §18.3): в `summary`
 * попадают только внутренние коды, количества и суммы.
 *
 * §2.3 определяет два ОБЩИХ аккаунта, поэтому журнал фиксирует роль и аккаунт,
 * но не человека. Это ограничение ТЗ, а не недоработка — см. противоречие C-15.
 */
import type { DbLike } from '@/db/client';
import { auditLog } from '@/db/schema';
import type { UserRole } from '@/db/schema';

export const AUDIT_ACTIONS = {
  loginSucceeded: 'login.succeeded',
  loginFailed: 'login.failed',
  loginLocked: 'login.locked',
  logout: 'logout',
  passwordChanged: 'account.password_changed',
  itemCreated: 'item.created',
  itemUpdated: 'item.updated',
  itemCostChanged: 'item.cost_changed',
  stockReceived: 'stock.received',
  stockAdjusted: 'stock.adjusted',
  countApplied: 'inventory_count.applied',
  countDeleted: 'inventory_count.deleted',
  packCreated: 'pack.created',
  packUpdated: 'pack.updated',
  packDeleted: 'pack.deleted',
  packArchived: 'pack.archived',
  itemDeleted: 'item.deleted',
  itemArchived: 'item.archived',
  doctorCreated: 'doctor.created',
  doctorUpdated: 'doctor.updated',
  doctorDeleted: 'doctor.deleted',
  doctorArchived: 'doctor.archived',
  operationStarted: 'operation.started',
  operationDoctorChanged: 'operation.doctor_changed',
  operationFinished: 'operation.finished',
  operationVoided: 'operation.voided',
  operationDeleted: 'operation.deleted',
  settingChanged: 'setting.changed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  action: AuditAction;
  actorAccountId?: number | null;
  actorRole?: UserRole | null;
  entityType?: string | null;
  entityId?: number | null;
  summary?: string | null;
}

export function writeAudit(tx: DbLike, entry: AuditEntry): void {
  tx.insert(auditLog)
    .values({
      action: entry.action,
      actorAccountId: entry.actorAccountId ?? null,
      actorRole: entry.actorRole ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      summary: entry.summary ?? null,
      createdAt: new Date(),
    })
    .run();
}
