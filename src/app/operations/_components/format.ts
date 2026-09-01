/**
 * Форматирование времени для раздела Operations.
 *
 * D-15: время хранится в unix-миллисекундах UTC и отображается в часовом поясе
 * клиники America/New_York; Intl автоматически учитывает EST/EDT.
 *
 * Формат явно 24-часовой и с датой: строка «14:05» без даты в истории операций
 * неоднозначна, а операция может длиться через полночь.
 */
export function formatDateTime(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  });
}
