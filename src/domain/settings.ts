/**
 * Системные настройки (§3.2, §7.10, §3.3; Q-16 — сущности в §17 нет).
 */
import { eq } from 'drizzle-orm';
import type { AppDatabase, DbLike } from '@/db/client';
import { systemSettings } from '@/db/schema';
import { assertAdmin, type Actor } from './actor';
import { AUDIT_ACTIONS, writeAudit } from './audit';
import { runInTransaction } from './movements';

export const SETTING_KEYS = {
  /** §3.2: по умолчанию Staff не обязан видеть стоимость. Скрытие — на сервере. */
  staffCanSeeCost: 'staff_can_see_cost',
  /** §7.10: 'warn' | 'block'. Рекомендация ТЗ — 'warn'. */
  negativeStockMode: 'negative_stock_mode',
  procedureCategoryEnabled: 'procedure_category_enabled',
  soundOnScanEnabled: 'sound_on_scan_enabled',
  labelSizePreset: 'label_size_preset',
  /** Q-32: мягкий порог предупреждения о «залипшем» сканере. */
  largeQuantityWarnAt: 'large_quantity_warn_at',
} as const;

export const NEGATIVE_STOCK_MODES = ['warn', 'block'] as const;
export type NegativeStockMode = (typeof NEGATIVE_STOCK_MODES)[number];

export function getSetting(tx: DbLike, key: string): string | undefined {
  return tx
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .get()?.value;
}

export function setSetting(tx: DbLike, key: string, value: string): void {
  tx.insert(systemSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: new Date() },
    })
    .run();
}

export function getBooleanSetting(tx: DbLike, key: string, fallback: boolean): boolean {
  const raw = getSetting(tx, key);
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

export function getIntSetting(tx: DbLike, key: string, fallback: number): number {
  const raw = getSetting(tx, key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getNegativeStockMode(tx: DbLike): NegativeStockMode {
  const raw = getSetting(tx, SETTING_KEYS.negativeStockMode);
  return raw === 'block' ? 'block' : 'warn';
}

export function staffCanSeeCost(tx: DbLike): boolean {
  return getBooleanSetting(tx, SETTING_KEYS.staffCanSeeCost, false);
}

/**
 * Изменение настроек — административное действие (§3.3: «Staff не может видеть
 * административные настройки», §18.22). Роль проверяется здесь, в домене, а не
 * только в маршруте (D-10), и каждое изменение попадает в журнал (§15).
 */
export function updateSettings(
  db: AppDatabase,
  actor: Actor,
  patch: Record<string, string>,
): void {
  assertAdmin(actor, 'change settings');

  runInTransaction(db, (tx) => {
    for (const [key, value] of Object.entries(patch)) {
      const previous = getSetting(tx, key);
      if (previous === value) continue;
      setSetting(tx, key, value);
      writeAudit(tx, {
        action: AUDIT_ACTIONS.settingChanged,
        actorAccountId: actor.accountId,
        actorRole: actor.role,
        entityType: 'setting',
        summary: `${key}: ${previous ?? '(default)'} -> ${value}`,
      });
    }
  });
}
