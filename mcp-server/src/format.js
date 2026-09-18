// Rendering helpers. Deliberately copied rather than imported from src/lib/formatters.js:
// that module lives in Vite-land, and its formatDate is broken under ESM node (it calls
// require() inside a "type": "module" package and silently returns String(date)).

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const GBP_WHOLE = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

/** Money with pence. Sub-half-penny values snap to zero so -0 never renders as "-£0.00". */
export function money(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return GBP.format(Math.abs(num) < 0.005 ? 0 : num);
}

/** Money rounded to whole pounds - used in list output where pence are noise. */
export function moneyShort(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return GBP_WHOLE.format(Math.abs(num) < 0.5 ? 0 : num);
}

export function percent(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num.toFixed(decimals)}%`;
}

/** ISO YYYY-MM-DD. Unambiguous for a model and cheaper than a localised string. */
export function isoDate(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 10);
}

export function isoDateTime(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.toISOString().slice(0, 16)}Z`;
}

export function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A pipe-delimited row. Empty segments are dropped so lines stay short. */
export function row(parts) {
  return parts.filter((p) => p !== null && p !== undefined && p !== '').join(' | ');
}

export function section(title, lines) {
  const body = lines.filter(Boolean);
  if (body.length === 0) return '';
  return `${title}\n${body.map((l) => `  ${l}`).join('\n')}`;
}

export function labelled(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return `${label}: ${value}`;
}

/**
 * The footer every tool response ends with, so the model can always see what it is
 * looking at, how much it is NOT looking at, and how fresh the figures are.
 */
export function footer({ orgName, shown, total, asOf, extra }) {
  const parts = [`org: ${orgName}`];
  if (typeof shown === 'number') {
    parts.push(typeof total === 'number' && total > shown ? `rows: ${shown} of ${total}` : `rows: ${shown}`);
  }
  if (asOf) parts.push(`balances as of: ${isoDateTime(asOf)}`);
  if (extra) parts.push(extra);
  parts.push(`generated: ${isoDateTime(new Date())}`);
  return parts.join(' | ');
}

/**
 * Contract end date. There is no maturity_date column - it is start_date + duration,
 * and the unit comes from `period`. Do not copy src/lib/letterGenerator.js:128, which
 * always adds months and ignores period.
 */
export function contractEndDate(loan) {
  if (!loan?.start_date || !loan?.duration || !loan?.period) return null;
  const start = new Date(loan.start_date);
  if (Number.isNaN(start.getTime())) return null;
  const duration = Number(loan.duration);
  if (!Number.isFinite(duration)) return null;

  // All arithmetic in UTC: setMonth/setDate work in local time, which shifts the result
  // across a day boundary whenever the machine is not on UTC.
  const end = new Date(start);
  const period = String(loan.period).toLowerCase();
  if (period.startsWith('week')) {
    end.setUTCDate(end.getUTCDate() + duration * 7);
  } else if (period.startsWith('day')) {
    end.setUTCDate(end.getUTCDate() + duration);
  } else if (period.startsWith('quarter')) {
    end.setUTCMonth(end.getUTCMonth() + duration * 3);
  } else if (period.startsWith('year') || period.startsWith('annual')) {
    end.setUTCFullYear(end.getUTCFullYear() + duration);
  } else {
    end.setUTCMonth(end.getUTCMonth() + duration);
  }
  return end.toISOString().slice(0, 10);
}

export function borrowerLabel(borrower) {
  if (!borrower) return 'unknown borrower';
  return borrower.business || borrower.full_name ||
    [borrower.first_name, borrower.last_name].filter(Boolean).join(' ') || 'unnamed';
}
