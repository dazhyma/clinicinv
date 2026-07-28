'use server';

/**
 * Серверная обёртка над действием изменения настроек (§3.3).
 *
 * Роль проверяется здесь, в слое действий и ещё раз в домене (D-10): §3.2
 * прямо запрещает Staff видеть административные настройки, а прямой POST из-под
 * Staff должен получать отказ (§18.22).
 */
import { revalidatePath } from 'next/cache';
import { updateSettingsAction } from '@/actions/settings';
import { toFailure } from '@/actions/result';
import { requireActor } from '@/auth/guards';
import { getDb } from '@/db/client';
import type { FormState } from '../inventory/actions';

export async function updateSettingsFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let actor;
  try {
    actor = await requireActor();
  } catch (error) {
    const failure = toFailure(error);
    return { ok: false, error: failure.error };
  }

  const result = updateSettingsAction(getDb(), actor, {
    staffCanSeeCost: String(formData.get('staffCanSeeCost') ?? ''),
    negativeStockMode: String(formData.get('negativeStockMode') ?? ''),
    soundOnScanEnabled: String(formData.get('soundOnScanEnabled') ?? ''),
  });

  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };

  // Настройка меняет то, какие поля сервер вообще кладёт в ответ, поэтому
  // кешированный список предметов обязан быть пересобран.
  revalidatePath('/inventory');
  revalidatePath('/settings');

  return { ok: true, message: 'Settings saved.' };
}
