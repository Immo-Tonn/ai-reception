/** Shared layout math for the desktop time-grid (Week / Staff views). */
export const GRID_DAY_START_MINUTES = 8 * 60; // 08:00
export const GRID_DAY_END_MINUTES = 20 * 60; // 20:00
export const GRID_SLOT_MINUTES = 30;

export const GRID_ROW_COUNT =
  (GRID_DAY_END_MINUTES - GRID_DAY_START_MINUTES) / GRID_SLOT_MINUTES;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function gridHourLabels(): string[] {
  const labels: string[] = [];
  for (let m = GRID_DAY_START_MINUTES; m < GRID_DAY_END_MINUTES; m += 60) {
    labels.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:00`);
  }
  return labels;
}

export function getGridPlacement(time: string, durationMinutes: number) {
  const start = toMinutes(time);
  const rowStart = Math.max(
    1,
    Math.round((start - GRID_DAY_START_MINUTES) / GRID_SLOT_MINUTES) + 1,
  );
  const rowSpan = Math.max(1, Math.round(durationMinutes / GRID_SLOT_MINUTES));
  return { rowStart, rowSpan };
}
