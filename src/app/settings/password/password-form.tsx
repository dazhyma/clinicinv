'use client';

import { useActionState, useState } from 'react';
import type { AccountOptionView } from '@/actions/accounts';
import { MIN_PASSWORD_LENGTH } from '@/auth/password-rules';
import { PasswordInput } from '../../_components/password-input';
import { Alert, Select } from '../../_components/ui';
import { ErrorBanner, Field, SubmitButton, SuccessBanner } from '../../inventory/_components/form-field';
import { changePasswordFormAction, type PasswordFormState } from './actions';

const initialState: PasswordFormState = {};

/**
 * Форма смены пароля (§3.3, FR-12).
 *
 * Поля паролей — `type="password"` с осмысленным `autoComplete`, чтобы менеджер
 * паролей предложил сохранить новый, а не подставил старый. React сбрасывает
 * неуправляемые поля формы после завершения действия — набранный пароль на
 * экране не остаётся.
 *
 * Целевой аккаунт хранится в контролируемом state и отправляется отдельным
 * hidden input. Это важно для Safari/React Server Actions: неконтролируемый
 * select с `defaultValue=Admin` мог вернуться к default перед сериализацией
 * формы и отправить id Admin после визуального выбора Staff.
 */
export function PasswordForm({
  accounts,
  currentAccountId,
}: {
  accounts: AccountOptionView[];
  currentAccountId: number;
}) {
  const [state, formAction] = useActionState(changePasswordFormAction, initialState);
  const [selectedAccountId, setSelectedAccountId] = useState(String(currentAccountId));
  const fieldErrors = state.fieldErrors ?? {};
  const selectedAccount =
    accounts.find((account) => String(account.accountId) === selectedAccountId) ?? accounts[0];
  const untouchedAccount = accounts.find(
    (account) => account.accountId !== selectedAccount?.accountId,
  );

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-6">
      <ErrorBanner message={state.error} />
      {state.ok && String(state.changedAccountId) === selectedAccountId ? (
        <SuccessBanner message={state.message} />
      ) : null}

      <Field
        name="accountId"
        label="Account"
        required
        error={fieldErrors.accountId}
        hint="Changing a password signs that account out on other devices. This Admin session stays open when changing its own password."
      >
        {({ name, ...props }) => (
          <>
            <Select
              {...props}
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.currentTarget.value)}
            >
              {accounts.map((account) => (
                <option key={account.accountId} value={String(account.accountId)}>
                  {account.username} · {account.role}
                </option>
              ))}
            </Select>
            <input type="hidden" name={name} value={selectedAccountId} />
            <input
              type="hidden"
              name="targetUsername"
              value={selectedAccount?.username ?? ''}
            />
          </>
        )}
      </Field>

      <Alert tone="info">
        <div>
        <p className="text-sm font-medium uppercase tracking-wide">Target account</p>
        <p className="mt-1 text-xl font-semibold">
          {selectedAccount?.username} · {selectedAccount?.role}
        </p>
        {untouchedAccount ? (
          <p className="mt-1 text-sm">
            The password for {untouchedAccount.username} will not be changed.
          </p>
        ) : null}
        </div>
      </Alert>

      {/* Подтверждение личности: без него чужая незалоченная сессия Admin
          позволяла бы сменить пароли обоих аккаунтов клиники. */}
      <Field
        name="currentPassword"
        label="Current Admin password"
        required
        error={fieldErrors.currentPassword}
        hint={
          selectedAccount?.role === 'Staff'
            ? 'Confirms that you are the signed-in Admin. Do not enter the old Staff password here.'
            : 'Enter the current password for the signed-in Admin account.'
        }
      >
        {(props) => <PasswordInput autoComplete="current-password" {...props} />}
      </Field>

      <Field
        name="newPassword"
        label="New password"
        required
        error={fieldErrors.newPassword}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. Stored only as an argon2id hash.`}
      >
        {(props) => (
          <PasswordInput
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            {...props}
          />
        )}
      </Field>

      <Field
        name="confirmPassword"
        label="Repeat new password"
        required
        error={fieldErrors.confirmPassword}
      >
        {(props) => (
          <PasswordInput
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            {...props}
          />
        )}
      </Field>

      <SubmitButton pendingLabel="Changing…">
        Change password for {selectedAccount?.username ?? 'selected account'}
      </SubmitButton>
    </form>
  );
}
