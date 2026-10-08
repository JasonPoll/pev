const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });

export function formatNumber(value: number | undefined): string {
  return value === undefined ? '' : numberFormat.format(value);
}

// durations are in milliseconds; returns the value and its unit separately so the unit can be styled
export function formatDuration(ms: number | undefined): { value: string; unit: string } {
  if (ms === undefined) return { value: '', unit: '' };
  if (ms < 1) return { value: '<1', unit: 'ms' };
  if (ms < 1000) return { value: formatNumber(ms), unit: 'ms' };
  if (ms < 60000) return { value: formatNumber(ms / 1000), unit: 's' };
  return { value: formatNumber(ms / 60000), unit: 'min' };
}

export function durationText(ms: number | undefined): string {
  const { value, unit } = formatDuration(ms);
  return value ? `${value} ${unit}` : '';
}

// Postgres blocks are 8kB by default
export function formatBlocks(blocks: number): string {
  const bytes = blocks * 8192;
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${numberFormat.format(size)} ${units[unit]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value, null, 1);
  return String(value);
}
