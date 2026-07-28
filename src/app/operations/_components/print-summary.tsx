'use client';

/**
 * Print Summary (§12.3, FR-126).
 *
 * Отдельный крошечный клиентский компонент нужен потому, что `window.print()`
 * вызывается только в браузере, а сама страница сводки остаётся серверной:
 * данные операции не должны попадать в клиентский бандл ради одной кнопки.
 */
export function PrintSummaryButton({ label = 'Print Summary' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl bg-slate-900 px-8 py-4 text-lg font-semibold text-white"
    >
      {label}
    </button>
  );
}
