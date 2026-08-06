import { LoadingState } from './_components/ui';

export default function Loading() {
  return (
    <main className="app-shell flex items-center justify-center">
      <div className="app-card w-full max-w-md">
        <LoadingState label="Loading clinic inventory…" />
      </div>
    </main>
  );
}

