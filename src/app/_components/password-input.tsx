'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Показывать длину без раскрытия самого пароля. */
  showCharacterCount?: boolean;
};

/**
 * Парольное поле с доступным переключателем видимости.
 *
 * Значение остаётся в самом input и не копируется в React state: так пароль
 * сбрасывается вместе с формой после Server Action. В state хранится только
 * безопасная для UI длина.
 */
export function PasswordInput({
  className,
  showCharacterCount = true,
  minLength,
  onInput,
  ...props
}: PasswordInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [length, setLength] = useState(0);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;

    const handleReset = () => {
      setVisible(false);
      setLength(0);
    };
    form.addEventListener('reset', handleReset);
    return () => form.removeEventListener('reset', handleReset);
  }, []);

  const countLabel = minLength
    ? `${length} / ${minLength} characters`
    : `${length} ${length === 1 ? 'character' : 'characters'}`;

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <input
          {...props}
          ref={inputRef}
          type={visible ? 'text' : 'password'}
          minLength={minLength}
          className={`${className ?? ''} pr-14`}
          onInput={(event) => {
            setLength(event.currentTarget.value.length);
            onInput?.(event);
          }}
        />
        <button
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex min-h-11 min-w-12 items-center justify-center rounded-r-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

      {showCharacterCount ? (
        <span className="text-right text-sm tabular-nums text-slate-500" aria-live="polite">
          {countLabel}
        </span>
      ) : null}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-6 w-6"
    >
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-6 w-6"
    >
      <path d="m3 3 18 18" />
      <path d="M10.6 6.15A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a15.8 15.8 0 0 1-2.1 2.75M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.8 9.8 0 0 0 3.1-.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
