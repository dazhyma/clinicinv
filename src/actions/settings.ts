/**
 * Действия над системными настройками (§3.3, Q-16).
 *
 * §3.2 прямо запрещает Staff видеть административные настройки, поэтому и
 * чтение, и запись здесь требуют роли Admin. Проверка дублируется в домене
 * (`updateSettings` → `assertAdmin`) — см. D-10.
 */
import type { AppDatabase } from '@/db/client';
import { isAdmin, type Actor } from '@/domain/actor';
import {
  NEGATIVE_STOCK_MODES,
  SETTING_KEYS,
  getBooleanSetting,
  getNegativeStockMode,
  staffCanSeeCost,
  updateSettings,
} from '@/domain/settings';
import { FieldValidator, type RawFormValue } from './parse';
import { failFields, forbidden, runAction, type ActionResult } from './result';

export interface SettingsView {
  /** §3.2 / Q-1: по умолчанию Staff стоимость не видит. */
  staffCanSeeCost: boolean;
  /** §7.10 / Q-4: 'warn' — рекомендованный ТЗ режим. */
  negativeStockMode: (typeof NEGATIVE_STOCK_MODES)[number];
  /** §7.5, шаг 6: звук скана. По умолчанию включён. */
  soundOnScanEnabled: boolean;
}

export function readSettings(db: AppDatabase, actor: Actor): SettingsView {
  if (!isAdmin(actor)) throw new Error('readSettings requires an Admin actor');
  return {
    staffCanSeeCost: staffCanSeeCost(db),
    negativeStockMode: getNegativeStockMode(db),
    soundOnScanEnabled: getBooleanSetting(db, SETTING_KEYS.soundOnScanEnabled, true),
  };
}

export interface SettingsFormInput {
  staffCanSeeCost?: RawFormValue;
  negativeStockMode?: RawFormValue;
  soundOnScanEnabled?: RawFormValue;
}

const BOOLEAN_CHOICES = ['true', 'false'] as const;

export function updateSettingsAction(
  db: AppDatabase,
  actor: Actor,
  input: SettingsFormInput,
): ActionResult<SettingsView> {
  if (!isAdmin(actor)) return forbidden('change settings');

  const v = new FieldValidator();
  const staffCost = v.oneOf(
    'staffCanSeeCost',
    input.staffCanSeeCost,
    BOOLEAN_CHOICES,
    'Cost visibility for Staff',
  );
  const negativeMode = v.oneOf(
    'negativeStockMode',
    input.negativeStockMode,
    NEGATIVE_STOCK_MODES,
    'Negative stock mode',
  );
  const scanSound = v.oneOf(
    'soundOnScanEnabled',
    input.soundOnScanEnabled ?? 'true',
    BOOLEAN_CHOICES,
    'Scan sound',
  );
  if (v.hasErrors) return failFields(v.errors);

  return runAction(() => {
    updateSettings(db, actor, {
      [SETTING_KEYS.staffCanSeeCost]: staffCost,
      [SETTING_KEYS.negativeStockMode]: negativeMode,
      [SETTING_KEYS.soundOnScanEnabled]: scanSound,
    });
    return {
      staffCanSeeCost: staffCost === 'true',
      negativeStockMode: negativeMode,
      soundOnScanEnabled: scanSound === 'true',
    };
  });
}
