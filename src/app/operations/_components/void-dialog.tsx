'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button } from '../../_components/ui';
import { voidOperationServerAction } from '../actions';

/**
 * Void Operation (§9.3). Кнопка отображается только Admin, но это эргономика:
 * само действие отклоняется сервером для Staff (§18.22, D-10).
 *
 * Текст подтверждения — дословно из §9.3. Причина необязательна (§9.3, FR-102)
 * и не должна содержать данных пациента (§18.3) — предупреждение стоит у поля.
 */
export function VoidOperationButton({
  operationId,
  caseCode,
  redirectTo,
  variant = 'inline',
}: {
  operationId: number;
  caseCode: string;
  /** Куда уйти после успеха. Без значения — обновление текущего экрана. */
  redirectTo?: string;
  variant?: 'inline' | 'block';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await voidOperationServerAction({ operationId, reason });
      if (!result.ok) {
        // §14.4: сюда попадает и «Operation was already voided» — конкретное
        // сообщение сервера показывается дословно.
        setError(result.error);
        return;
      }
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch {
      setError('The operation was not voided — check connection and try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="danger"
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'block'
            ? 'w-full'
            : ''
        }
      >
        Void Operation
      </Button>

      {open ? (
        <div className="modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Void Operation ${caseCode}`}
            className="modal-panel app-card w-full max-w-lg p-6 shadow-[var(--shadow-raised)]"
          >
            <h2 className="text-2xl font-semibold">Void Operation {caseCode}?</h2>
            <p className="mt-3 text-lg text-slate-700">
              All inventory deducted by this operation will be returned.
            </p>
            <p className="text-lg text-slate-700">
              The operation will be excluded from financial totals.
            </p>

            <label htmlFor={`void-reason-${operationId}`} className="mt-5 block text-base font-medium">
              Reason <span className="font-normal text-slate-500">optional</span>
            </label>
            <input
              id={`void-reason-${operationId}`}
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-lg"
            />
            <p className="mt-1 text-sm text-slate-500">Never enter patient information.</p>

            {error ? (
              <Alert tone="danger" className="mt-4">{error}</Alert>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                type="button"
                onClick={confirm}
                disabled={busy}
              >
                {busy ? 'Voiding…' : 'Void Operation'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
