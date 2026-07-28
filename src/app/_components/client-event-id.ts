/**
 * Ключ идемпотентности, генерируемый КЛИЕНТОМ (§10.4, §16, Q-8).
 *
 * Один и тот же ключ должен пережить двойной клик, повторную отправку формы и
 * ретрай после таймаута: уникальный индекс `ux_inventory_movements_idempotency`
 * не даст применить движение дважды. Ключ меняется только после подтверждённого
 * успеха — тогда следующее действие пользователя считается новым событием.
 *
 * `crypto.randomUUID()` доступен лишь в защищённом контексте (HTTPS или
 * localhost). Клиника работает по HTTPS (§15), но запасной вариант нужен, чтобы
 * форма не падала при локальной отладке по http.
 */
export function newClientEventId(): string {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID();
  }
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    const bytes = globalCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
