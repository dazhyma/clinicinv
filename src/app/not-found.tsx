import { ButtonLink } from './_components/ui';

export default function NotFound() {
  return (
    <main className="app-shell flex items-center justify-center">
      <section className="app-card w-full max-w-lg p-7 text-center sm:p-9">
        <p className="text-sm font-semibold tracking-[0.14em] text-slate-500 uppercase">Not Found</p>
        <h1 className="mt-2 text-3xl font-bold">This page does not exist</h1>
        <p className="mt-2 mb-6 text-slate-600">Return to the home screen and choose an available section.</p>
        <ButtonLink href="/">Return Home</ButtonLink>
      </section>
    </main>
  );
}

