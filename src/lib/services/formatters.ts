import { DateTime, Duration } from 'luxon';

export const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
export const number = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 6 });
export const date = new Intl.DateTimeFormat('en-BE', { dateStyle: 'long', timeZone: 'UTC' });
export const updatedAt = new Intl.DateTimeFormat('en-BE', { dateStyle: 'medium', timeStyle: 'long' });
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
export const percent = (value: number) => value.toLocaleString('nl-BE', { maximumFractionDigits: 2 });
export function relativeUpdatedAt(value: Date, now = new Date()) {
  const difference = value.getTime() - now.getTime();
  const magnitude = Math.abs(difference);
  const units = [
    { unit: 'year', milliseconds: 365 * 24 * 60 * 60 * 1000 },
    { unit: 'month', milliseconds: 30 * 24 * 60 * 60 * 1000 },
    { unit: 'day', milliseconds: 24 * 60 * 60 * 1000 },
    { unit: 'hour', milliseconds: 60 * 60 * 1000 },
    { unit: 'minute', milliseconds: 60 * 1000 }
  ] as const;
  const selected = units.find(({ milliseconds }) => magnitude >= milliseconds);
  return selected ? relativeTime.format(Math.round(difference / selected.milliseconds), selected.unit) : 'less than a minute ago';
}
export function duration(from: string, to: string) {
  const start = DateTime.fromISO(from, { zone: 'utc' });
  const end = DateTime.fromISO(to, { zone: 'utc' });
  return Duration.fromObject(end.diff(start, ['years', 'months', 'days']).toObject()).toHuman({ listStyle: 'long' });
}
