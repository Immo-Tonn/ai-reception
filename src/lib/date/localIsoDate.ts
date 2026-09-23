/**
 * `Date#toISOString()` returns the UTC calendar date, which silently
 * shifts by a day for anyone west/east of UTC once the local clock is
 * near midnight — appointments would land on the wrong day in the grid.
 * Every date-only conversion in the app goes through this instead.
 */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
