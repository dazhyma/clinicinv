'use client';

import { useActionState } from 'react';
import { PasswordInput } from '../_components/password-input';
import { Alert, Button, FieldLabel, Input } from '../_components/ui';
import { loginAction, type LoginFormState } from './actions';

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <FieldLabel htmlFor="username">
          Username
        </FieldLabel>
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          className="text-lg"
        />
      </div>

      <div>
        <FieldLabel htmlFor="password">
          Password
        </FieldLabel>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          className="ui-field text-lg"
        />
      </div>

      {/* §3.1: область сообщения об ошибке. Текст конкретный (§14.4). */}
      {state.error ? (
        <Alert tone="danger">{state.error}</Alert>
      ) : null}

      <Button
        type="submit"
        disabled={pending}
        fullWidth
        size="large"
      >
        {pending ? 'Logging in…' : 'Log In'}
      </Button>
    </form>
  );
}
