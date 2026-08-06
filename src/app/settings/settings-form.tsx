'use client';

import { useActionState, type ReactNode } from 'react';
import type { SettingsView } from '@/actions/settings';
import type { FormState } from '../inventory/actions';
import { ErrorBanner, SubmitButton, SuccessBanner } from '../inventory/_components/form-field';
import { updateSettingsFormAction } from './actions';

const initialState: FormState = {};

export function SettingsForm({ settings }: { settings: SettingsView }) {
  const [state, formAction] = useActionState(updateSettingsFormAction, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <ErrorBanner message={state.error} />
      {state.ok ? <SuccessBanner message={state.message} /> : null}

      <SettingsSection
        title="Staff Permissions"
        description="Choose what the shared Staff account can access."
      >
        <ToggleRow
          name="staffCanSeeCost"
          label="View inventory cost"
          description="Allow Staff to see cost values. When disabled, values are not sent to Staff sessions."
          checked={settings.staffCanSeeCost}
          error={fieldErrors.staffCanSeeCost}
        />
      </SettingsSection>

      <SettingsSection
        title="Operation Settings"
        description="Controls used while supplies are recorded during an operation."
      >
        <div className="grid gap-2">
          <label htmlFor="negativeStockMode" className="font-semibold">
            When stock is not enough
          </label>
          <p className="text-sm text-slate-600">
            Choose whether to warn or block when an operation would create negative stock.
          </p>
          <select
            id="negativeStockMode"
            name="negativeStockMode"
            defaultValue={settings.negativeStockMode}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg"
          >
            <option value="warn">Allow with a clear warning (recommended)</option>
            <option value="block">Block when stock is insufficient</option>
          </select>
          {fieldErrors.negativeStockMode ? (
            <p className="text-sm text-red-700">{fieldErrors.negativeStockMode}</p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Other Settings" description="Interface feedback and device behavior.">
        <ToggleRow
          name="soundOnScanEnabled"
          label="Sound on scan"
          description="Play a confirmation tone after a scan and a lower tone for errors."
          checked={settings.soundOnScanEnabled}
          error={fieldErrors.soundOnScanEnabled}
        />
      </SettingsSection>

      <div className="app-card sticky bottom-3 z-10 bg-[color:rgb(252_250_247/0.94)] p-4 shadow-[var(--shadow-raised)] backdrop-blur-md">
        <SubmitButton>Save Settings</SubmitButton>
      </div>
    </form>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="app-card p-5 sm:p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 mb-5 text-slate-600">{description}</p>
      {children}
    </section>
  );
}

function ToggleRow({
  name,
  label,
  description,
  checked,
  error,
}: {
  name: string;
  label: string;
  description: string;
  checked: boolean;
  error?: string;
}) {
  return (
    <div>
      <label className="flex min-h-20 cursor-pointer items-center justify-between gap-5 rounded-xl border border-transparent bg-[var(--color-surface-muted)]/55 p-4 transition hover:border-slate-300">
        <span>
          <span className="block font-semibold">{label}</span>
          <span className="mt-1 block text-sm text-slate-600">{description}</span>
        </span>
        <span className="relative shrink-0">
          <input
            type="checkbox"
            name={name}
            value="true"
            defaultChecked={checked}
            className="peer sr-only"
          />
          <span className="block h-8 w-14 rounded-full bg-slate-300 ring-offset-2 transition peer-focus-visible:ring-3 peer-focus-visible:ring-[var(--color-focus)] peer-checked:bg-[var(--color-primary)]" />
          <span className="absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition peer-checked:translate-x-6" />
        </span>
      </label>
      <input type="hidden" name={name} value="false" />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
