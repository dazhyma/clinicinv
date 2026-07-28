import { listAccountsForPasswordChange } from '@/actions/accounts';
import { requirePageAdmin } from '@/auth/guards';
import { getDb } from '@/db/client';
import { AppHeader } from '../../_components/app-header';
import { PasswordForm } from './password-form';

export const dynamic = 'force-dynamic';

/**
 * Смена паролей двух аккаунтов (§3.3, FR-12).
 *
 * Страница закрыта для Staff тремя независимыми рубежами: `requirePageAdmin()`
 * здесь, проверка роли в `changeAccountPasswordAction()` и `setAccountPassword()`
 * в домене (D-10). Отсутствие ссылки в интерфейсе Staff защитой не считается —
 * прямой заход на `/settings/password` из-под Staff уводит на главную, а прямой
 * POST server action получает отказ (§18.22).
 *
 * До этого экрана единственным способом сменить пароль был `npm run db:seed`
 * с паролем открытым текстом в `.env` — то есть после увольнения сотрудника
 * клиника не могла закрыть доступ (§3.3 требует обратного).
 */
export default async function ChangePasswordPage() {
  const { account, actor } = await requirePageAdmin();
  const accounts = listAccountsForPasswordChange(getDb(), actor);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4 sm:p-6">
      <AppHeader
        title="Change Password"
        backHref="/settings"
        backLabel="Settings"
        account={{ username: account.username, role: account.role }}
      />

      <p className="mb-6 max-w-xl text-base text-slate-600">
        The clinic has two shared accounts. Admin can change the password of either one. The
        password is stored only as an argon2id hash and is never shown again.
      </p>

      <PasswordForm accounts={accounts} currentAccountId={account.id} />
    </main>
  );
}
