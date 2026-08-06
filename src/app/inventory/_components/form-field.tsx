'use client';

import { useFormStatus } from 'react-dom';
import { AutoDismissAlert } from '../../_components/auto-dismiss-alert';
import { Alert, buttonClassName } from '../../_components/ui';

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
      <label htmlFor={name} className="ui-label text-base">
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
        className: `ui-field text-lg ${
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
    <Alert tone="danger">{message}</Alert>
  );
}

export function SuccessBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <AutoDismissAlert>{message}</AutoDismissAlert>
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
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClassName({ variant, size: 'large', className: 'w-full sm:w-auto' })}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
