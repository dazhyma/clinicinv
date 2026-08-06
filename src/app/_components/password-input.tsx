'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';

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
          title={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex min-h-11 min-w-12 items-center justify-center rounded-r-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)]"
        >
          {visible ? <EyeOffIcon size={22} /> : <EyeIcon size={22} />}
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
