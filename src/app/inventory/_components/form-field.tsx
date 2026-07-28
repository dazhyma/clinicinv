'use client';

import { useFormStatus } from 'react-dom';

/**
 * Поле формы с явной связью label ↔ input и ошибкой, привязанной к полю.
 *
 * Требования: формы доступны с клавиатуры, у каждого поля есть связанный label,
 * ошибки валидации привязаны к полям (§14.1). Поэтому здесь всегда есть
 * `htmlFor`/`id`, `aria-invalid` и `aria-describedby`, а не просто красный текст.
 */
export function Field({
  name,
  label,
  error,
  hint,
  required,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    name: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
    required: boolean | undefined;
    className: string;
  }) => React.ReactNode;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-base font-medium">
        {label}
        {required ? (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-2 text-sm font-normal text-slate-500">optional</span>
        )}
      </label>

      {children({
        id: name,
        name,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
        required: required || undefined,
        className: `w-full rounded-lg border px-3 py-3 text-lg ${
          error ? 'border-red-500 bg-red-50' : 'border-slate-300'
        }`,
      })}

      {hint ? (
        <p id={hintId} className="text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-base font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** §14.4: сообщение конкретное, видимое и озвучиваемое скринридером. */
export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-lg text-red-800 ring-1 ring-red-200">
      {message}
    </p>
  );
}

export function SuccessBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-lg bg-emerald-50 px-4 py-3 text-lg text-emerald-900 ring-1 ring-emerald-200"
    >
      {message}
    </p>
  );
}

/**
 * Кнопка отправки. Блокируется на время запроса — это защита от случайного
 * второго нажатия (§14.1), но НЕ единственная: настоящую гарантию даёт ключ
 * идемпотентности на сервере (§10.4).
 */
export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant = 'primary',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'danger';
}) {
  const { pending } = useFormStatus();
  const base =
    'w-full rounded-xl px-5 py-4 text-lg font-semibold text-white disabled:opacity-60 sm:w-auto';
  const color = variant === 'danger' ? 'bg-red-700' : 'bg-slate-900';

  return (
    <button type="submit" disabled={pending} className={`${base} ${color}`}>
      {pending ? pendingLabel : children}
    </button>
  );
}
