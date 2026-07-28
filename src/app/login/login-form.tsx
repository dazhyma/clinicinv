'use client';

import { useActionState } from 'react';
import { PasswordInput } from '../_components/password-input';
import { loginAction, type LoginFormState } from './actions';

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-3 text-lg"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-3 text-lg"
        />
      </div>

      {/* §3.1: область сообщения об ошибке. Текст конкретный (§14.4). */}
      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-slate-900 px-4 py-3 text-lg font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Logging in…' : 'Log In'}
      </button>
    </form>
  );
}
