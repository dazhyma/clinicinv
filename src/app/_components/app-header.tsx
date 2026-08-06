import Link from 'next/link';
import { logoutAction } from '../login/actions';
import { ArrowLeftIcon } from './icons';
import { buttonClassName } from './ui';

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
    <header className="no-print mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
      <div className="min-w-0 flex-1">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-2 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeftIcon size={18} /> {backLabel}
          </Link>
        ) : null}
        <h1 className="text-3xl font-bold tracking-tight sm:text-[2rem]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-slate-600">{subtitle}</p> : null}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {account ? (
          <span className="hidden rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600 sm:inline-flex">
            {account.username}<span className="mx-1.5 text-slate-400">·</span>{account.role}
          </span>
        ) : null}
        <form action={logoutAction}>
          <button
            type="submit"
            className={buttonClassName({ variant: 'secondary', size: 'compact' })}
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
