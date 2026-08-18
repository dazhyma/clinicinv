'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button } from '../../_components/ui';
import { deleteVoidedOperationServerAction } from '../actions';

/**
 * Окончательное удаление показывается только для Voided operation. Скрытая
 * кнопка не является защитой: server action и домен повторно требуют Admin.
 */
export function DeleteOperationButton({
  operationId,
  caseCode,
  redirectTo,
  fullWidth = false,
}: {
  operationId: number;
  caseCode: string;
  redirectTo?: string;
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteVoidedOperationServerAction(operationId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch {
      setError('The surgery was not deleted — check connection and try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="danger"
        type="button"
        fullWidth={fullWidth}
        onClick={() => setOpen(true)}
      >
        Delete Surgery
      </Button>

      {open ? (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-operation-${operationId}`}
            className="modal-panel app-card w-full max-w-lg p-6 shadow-[var(--shadow-raised)]"
          >
            <h2 id={`delete-operation-${operationId}`} className="text-2xl font-bold">
              Delete voided surgery?
            </h2>
            <p className="mt-3 text-slate-700">
              Surgery {caseCode} will be permanently deleted. This action cannot be undone.
            </p>

            {error ? <Alert tone="danger" className="mt-4">{error}</Alert> : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="danger" type="button" disabled={busy} onClick={confirm}>
                {busy ? 'Deleting…' : 'Delete Surgery'}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
