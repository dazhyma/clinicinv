/** Разрешает returnTo только на список Items; внешние и произвольные URL отбрасываются. */
export function itemsReturnPath(value: string | undefined): string {
  if (!value?.startsWith('/')) return '/inventory/catalog';
  try {
    const parsed = new URL(value, 'http://clinic.local');
    if (parsed.origin !== 'http://clinic.local' || parsed.pathname !== '/inventory/catalog') {
      return '/inventory/catalog';
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/inventory/catalog';
  }
}
