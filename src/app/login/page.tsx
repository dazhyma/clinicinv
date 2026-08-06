import { redirect } from 'next/navigation';
import { getSessionContext } from '@/auth/guards';
import { BoxesIcon } from '../_components/icons';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/**
 * §3.1: страница входа. Поля username и password, кнопка Log In, область
 * сообщения об ошибке. Переключателя Staff/Admin нет — уровень доступа
 * определяется учётными данными.
 */
export default async function LoginPage() {
  if (await getSessionContext()) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="app-card w-full max-w-md p-6 shadow-[var(--shadow-raised)] sm:p-9">
        <div className="mb-7">
          <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-sage)] text-[var(--color-primary-active)]"><BoxesIcon size={30} /></span>
          <h1 className="text-3xl font-bold">Clinic Inventory</h1>
          <p className="mt-2 text-slate-600">Sign in to continue to the inventory system.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
