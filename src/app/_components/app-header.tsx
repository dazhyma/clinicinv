import Link from 'next/link';
import { logoutAction } from '../login/actions';

/**
 * Общая шапка внутренних экранов (§14.1: единообразие, крупные зоны нажатия).
 *
 * На печатной странице шапка скрывается классом `no-print` (§5.6).
 */
export function AppHeader({
  title,
  subtitle,
  backHref,
  backLabel = 'Back',
  account,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  account?: { username: string; role: string };
}) {
  return (
    <header className="no-print mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
      <div className="min-w-0">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-1 inline-flex items-center gap-1 text-base text-slate-600 underline underline-offset-4"
          >
            <span aria-hidden="true">←</span> {backLabel}
          </Link>
        ) : null}
        <h1 className="truncate text-2xl font-semibold">{title}</h1>
        {subtitle ? <p className="text-slate-600">{subtitle}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        {account ? (
          <span className="hidden text-sm text-slate-500 sm:inline">
            {account.username} · {account.role}
          </span>
        ) : null}
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700"
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
