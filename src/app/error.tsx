'use client';

import { AlertIcon } from './_components/icons';
import { Button } from './_components/ui';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="app-shell flex items-center justify-center">
      <section className="app-card w-full max-w-lg p-7 text-center sm:p-9">
        <span className="mx-auto mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-800"><AlertIcon size={28} /></span>
        <h1 className="text-2xl font-bold">This page could not be loaded</h1>
        <p className="mt-2 mb-6 text-slate-600">Your inventory data was not changed. Try loading the page again.</p>
        <Button onClick={reset}>Try Again</Button>
      </section>
    </main>
  );
}

