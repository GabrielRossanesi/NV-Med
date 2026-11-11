import { localDate } from './scheduling.ts';

export function moveScheduleMonth(value: string, offset: number) {
  const date = new Date(value + 'T12:00:00');
  const first = new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
  first.setDate(Math.min(date.getDate(), lastDay));
  return localDate(first);
}
