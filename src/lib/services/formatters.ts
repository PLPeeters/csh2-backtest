import { DateTime, Duration } from 'luxon';

export const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
export const number = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 6 });
export const date = new Intl.DateTimeFormat('en-BE', { dateStyle: 'long', timeZone: 'UTC' });
export const updatedAt = new Intl.DateTimeFormat('en-BE', { dateStyle: 'medium', timeStyle: 'short' });
export const percent = (value: number) => value.toLocaleString('nl-BE', { maximumFractionDigits: 2 });
export function duration(from: string, to: string) {
  const start = DateTime.fromISO(from, { zone: 'utc' });
  const end = DateTime.fromISO(to, { zone: 'utc' });
  return Duration.fromObject(end.diff(start, ['years', 'months', 'days']).toObject()).toHuman({ listStyle: 'long' });
}
