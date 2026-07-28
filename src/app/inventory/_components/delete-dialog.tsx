'use client';

import { useActionState, useState, type ReactNode } from 'react';

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-red-700 px-5 py-3 text-lg font-semibold text-white hover:bg-red-800"
      >
        {triggerLabel}
      </button>
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
            className="modal-panel w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h2 id="delete-dialog-title" className="text-2xl font-bold">
              {title}
            </h2>
            <p className="mt-3 text-slate-700">{description}</p>
            {details ? <div className="mt-4 rounded-xl bg-slate-50 p-4">{details}</div> : null}
            {state.error ? (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-800">
                {state.error}
              </p>
            ) : null}
            <form action={formAction} className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <input type="hidden" name={fieldName} value={entityId} />
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-300 px-5 py-3 text-lg font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-xl bg-red-700 px-5 py-3 text-lg font-semibold text-white disabled:opacity-60"
              >
                {pending ? 'Deleting…' : confirmLabel}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
