'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { Alert, Button } from '../../_components/ui';

type DeleteState = { ok?: boolean; error?: string };

export function DeleteDialog({
  action,
  fieldName,
  entityId,
  triggerLabel,
  title,
  description,
  details,
  confirmLabel,
}: {
  action: (previous: DeleteState, formData: FormData) => Promise<DeleteState>;
  fieldName: 'itemId' | 'packId' | 'countId';
  entityId: number;
  triggerLabel: string;
  title: string;
  description: string;
  details?: ReactNode;
  confirmLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <>
      <Button
        variant="danger"
        type="button"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      {open ? (
        <div
          className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            className="modal-panel app-card w-full max-w-lg p-6 shadow-[var(--shadow-raised)]"
          >
            <h2 id="delete-dialog-title" className="text-2xl font-bold">
              {title}
            </h2>
            <p className="mt-3 text-slate-700">{description}</p>
            {details ? <div className="mt-4 rounded-xl bg-slate-50 p-4">{details}</div> : null}
            {state.error ? (
              <Alert tone="danger" className="mt-4">{state.error}</Alert>
            ) : null}
            <form action={formAction} className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <input type="hidden" name={fieldName} value={entityId} />
              <Button
                variant="secondary"
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                type="submit"
                disabled={pending}
              >
                {pending ? 'Deleting…' : confirmLabel}
              </Button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
