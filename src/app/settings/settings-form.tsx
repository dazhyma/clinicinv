'use client';

import { useActionState } from 'react';
import type { SettingsView } from '@/actions/settings';
import type { FormState } from '../inventory/actions';
import { ErrorBanner, Field, SubmitButton, SuccessBanner } from '../inventory/_components/form-field';
import { updateSettingsFormAction } from './actions';

const initialState: FormState = {};

export function SettingsForm({ settings }: { settings: SettingsView }) {
  const [state, formAction] = useActionState(updateSettingsFormAction, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-6">
      <ErrorBanner message={state.error} />
      {state.ok ? <SuccessBanner message={state.message} /> : null}

      {/* §3.2 / Q-1: по умолчанию Staff стоимость не видит. Когда настройка
          выключена, финансовые поля не попадают в ответ сервера вообще. */}
      <Field
        name="staffCanSeeCost"
        label="Cost visibility for Staff"
        required
        error={fieldErrors.staffCanSeeCost}
        hint="When hidden, cost values are not sent to Staff sessions at all."
      >
        {(props) => (
          <select defaultValue={String(settings.staffCanSeeCost)} {...props}>
            <option value="false">Hidden from Staff (default)</option>
            <option value="true">Visible to Staff</option>
          </select>
        )}
      </Field>

      {/* §7.10 / Q-4: рекомендованный ТЗ режим — предупреждать, а не блокировать. */}
      <Field
        name="negativeStockMode"
        label="When stock is not enough during an operation"
        required
        error={fieldErrors.negativeStockMode}
        hint="Blocking during a procedure can be dangerously inconvenient (§7.10)."
      >
        {(props) => (
          <select defaultValue={settings.negativeStockMode} {...props}>
            <option value="warn">Allow with a clear warning (recommended)</option>
            <option value="block">Block adding more than is in stock</option>
          </select>
        )}
      </Field>

      {/* §7.5, шаг 6: звук скана «если это поддерживается устройством».
          Настройка появилась вместе с экраном, который её читает (D-23). */}
      <Field
        name="soundOnScanEnabled"
        label="Sound on scan"
        required
        error={fieldErrors.soundOnScanEnabled}
        hint="A short tone confirms each scan; a lower tone marks an error or a warning."
      >
        {(props) => (
          <select defaultValue={String(settings.soundOnScanEnabled)} {...props}>
            <option value="true">On (default)</option>
            <option value="false">Off</option>
          </select>
        )}
      </Field>

      <SubmitButton>Save Settings</SubmitButton>
    </form>
  );
}
