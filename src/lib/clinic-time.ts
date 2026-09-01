export const CLINIC_TIME_ZONE = 'America/New_York';

function offsetAt(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const representedAsUtc = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day),
    Number(value.hour), Number(value.minute), Number(value.second));
  return representedAsUtc - instant.getTime();
}

/** Local Miami wall time -> UTC, including EST/EDT transitions. */
export function clinicLocalToUtc(date: string, endOfDay = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid report date');
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  let instant = new Date(wall);
  instant = new Date(wall - offsetAt(instant));
  instant = new Date(wall - offsetAt(instant));
  return instant;
}

/** Miami wall-clock value from datetime-local -> UTC, including EST/EDT. */
export function clinicLocalDateTimeToUtc(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Enter a valid Miami date and time');
  const [, year, month, day, hour, minute, second = '00'] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  let instant = new Date(wall);
  instant = new Date(wall - offsetAt(instant));
  instant = new Date(wall - offsetAt(instant));
  if (clinicDateTimeInput(instant, true) !== `${year}-${month}-${day}T${hour}:${minute}:${second}`) {
    throw new Error('This local time does not exist in Miami because of daylight saving time');
  }
  return instant;
}

/** UTC instant -> value suitable for a datetime-local control in Miami. */
export function clinicDateTimeInput(value: Date, includeSeconds = false): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const base = `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
  return includeSeconds ? `${base}:${fields.second}` : base;
}

export function clinicDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
