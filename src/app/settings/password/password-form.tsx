'use client';

import { useActionState } from 'react';
import type { AccountOptionView } from '@/actions/accounts';
import { MIN_PASSWORD_LENGTH } from '@/auth/password-rules';
import { PasswordInput } from '../../_components/password-input';
import type { FormState } from '../../inventory/actions';
import { ErrorBanner, Field, SubmitButton, SuccessBanner } from '../../inventory/_components/form-field';
import { changePasswordFormAction } from './actions';

const initialState: FormState = {};

/**
 * Форма смены пароля (§3.3, FR-12).
 *
 * Поля паролей — `type="password"` с осмысленным `autoComplete`, чтобы менеджер
 * паролей предложил сохранить новый, а не подставил старый. Ни одно значение не
 * попадает в разметку как `defaultValue`, и React сбрасывает неуправляемые поля
 * формы после завершения действия — набранный пароль на экране не остаётся.
 */
export function PasswordForm({
  accounts,
  currentAccountId,
}: {
  accounts: AccountOptionView[];
  currentAccountId: number;
}) {
  const [state, formAction] = useActionState(changePasswordFormAction, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-6">
      <ErrorBanner message={state.error} />
      {state.ok ? <SuccessBanner message={state.message} /> : null}

      <Field
        name="accountId"
        label="Account"
        required
        error={fieldErrors.accountId}
        hint="Changing a password signs that account out on other devices. This Admin session stays open when changing its own password."
      >
        {(props) => (
          <select defaultValue={String(currentAccountId)} {...props}>
            {accounts.map((account) => (
              <option key={account.accountId} value={String(account.accountId)}>
                {account.username} · {account.role}
              </option>
            ))}
          </select>
        )}
      </Field>

      {/* Подтверждение личности: без него чужая незалоченная сессия Admin
          позволяла бы сменить пароли обоих аккаунтов клиники. */}
      <Field
        name="currentPassword"
        label="Your current password"
        required
        error={fieldErrors.currentPassword}
        hint="The password of the account you are signed in with, not the one you are changing."
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

      <SubmitButton pendingLabel="Changing…">Change Password</SubmitButton>
    </form>
  );
}
