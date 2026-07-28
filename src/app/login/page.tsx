import { redirect } from 'next/navigation';
import { getSessionContext } from '@/auth/guards';
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="mb-6 text-2xl font-semibold">Clinic Inventory</h1>
        <LoginForm />
      </div>
    </main>
  );
}
