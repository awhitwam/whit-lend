/**
 * Report date-range presets
 *
 * Two kinds of period are offered on the report pages:
 *  - UK *personal* tax year: 6 April to 5 April inclusive.
 *  - Calendar year: 1 January to 31 December inclusive.
 *
 * Every boundary Date is built with a local-time constructor (`new Date(y, m, d)`) and
 * formatted with date-fns `format`, which also reads local time. Parsing an ISO string
 * instead (`new Date('2026-04-06')`) yields UTC *midnight*, which formats back to the
 * previous day in any timezone behind Greenwich. The only other Date constructed here is
 * `new Date()` for today, read via local accessors - "today" means the user's calendar day.
 *
 * Not to be confused with `getFinancialYear()` in
 * components/reconciliation-simple/ReconciledPanel.jsx, which groups reconciled entries by
 * the *company* financial year (1 Apr - 31 Mar). Different boundary, different purpose -
 * unifying them would silently re-bucket every entry dated 1-5 April.
 */

import { format } from 'date-fns';

/** April, 0-indexed, to match Date#getMonth. */
const APRIL = 3;

/** Day of April on which the UK personal tax year begins. */
const TAX_YEAR_START_DAY = 6;

/**
 * @typedef {Object} DateRangePreset
 * @property {string} key Stable identifier
 * @property {string} label Button label, e.g. 'Tax year 2026/27'
 * @property {string} hint Spelled-out range, for the button's title attribute
 * @property {string} from Inclusive start, 'yyyy-MM-dd'
 * @property {string} to Inclusive end, 'yyyy-MM-dd'
 */

/** Stable identifiers for the available presets. */
export const PRESET_KEYS = {
  THIS_TAX_YEAR: 'thisTaxYear',
  LAST_TAX_YEAR: 'lastTaxYear',
  THIS_YEAR: 'thisYear',
  LAST_YEAR: 'lastYear'
};

/**
 * Build the string forms of an inclusive range from two locally-constructed Dates.
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {{from: string, to: string, hint: string}}
 */
function buildRange(startDate, endDate) {
  return {
    from: format(startDate, 'yyyy-MM-dd'),
    to: format(endDate, 'yyyy-MM-dd'),
    hint: `${format(startDate, 'd MMM yyyy')} to ${format(endDate, 'd MMM yyyy')}`
  };
}

/**
 * The calendar year in which the UK personal tax year containing `date` began.
 * 2026-11-17 -> 2026 (tax year 2026/27); 2026-04-05 -> 2025, its final day;
 * 2026-04-06 -> 2026, its first day; 2027-01-01 -> 2026.
 * @param {Date} date
 * @returns {number}
 */
export function getUkTaxYearStartYear(date) {
  const year = date.getFullYear();
  const boundary = new Date(year, APRIL, TAX_YEAR_START_DAY);
  return date >= boundary ? year : year - 1;
}

/**
 * Display form of a tax year from its starting calendar year: 2026 -> '2026/27'.
 * @param {number} startYear
 * @returns {string}
 */
export function formatTaxYearLabel(startYear) {
  return `${startYear}/${String(startYear + 1).slice(-2)}`;
}

/**
 * 6 Apr startYear to 5 Apr startYear+1, inclusive.
 * @param {number} startYear
 * @returns {{from: string, to: string, hint: string}}
 */
function taxYearRange(startYear) {
  return buildRange(
    new Date(startYear, APRIL, TAX_YEAR_START_DAY),
    new Date(startYear + 1, APRIL, TAX_YEAR_START_DAY - 1)
  );
}

/**
 * 1 Jan to 31 Dec, inclusive.
 * @param {number} year
 * @returns {{from: string, to: string, hint: string}}
 */
function calendarYearRange(year) {
  return buildRange(new Date(year, 0, 1), new Date(year, 11, 31));
}

/**
 * Inclusive range for a preset key, or null if the key is unknown.
 * @param {string} key
 * @param {Date} [today]
 * @returns {{from: string, to: string, hint: string} | null}
 */
export function getPresetRange(key, today = new Date()) {
  const taxStart = getUkTaxYearStartYear(today);
  const year = today.getFullYear();

  switch (key) {
    case PRESET_KEYS.THIS_TAX_YEAR:
      return taxYearRange(taxStart);
    case PRESET_KEYS.LAST_TAX_YEAR:
      return taxYearRange(taxStart - 1);
    case PRESET_KEYS.THIS_YEAR:
      return calendarYearRange(year);
    case PRESET_KEYS.LAST_YEAR:
      return calendarYearRange(year - 1);
    default:
      return null;
  }
}

/**
 * The four quick periods, current before previous within each kind. Call this during
 * render rather than caching it at module scope, so labels and ranges stay correct across
 * a midnight or 6 April rollover in a long-lived session. It is four string builds - cheap
 * enough not to memoize.
 * @param {Date} [today]
 * @returns {DateRangePreset[]}
 */
export function getDateRangePresets(today = new Date()) {
  const taxStart = getUkTaxYearStartYear(today);
  const year = today.getFullYear();

  return [
    {
      key: PRESET_KEYS.THIS_TAX_YEAR,
      label: `Tax year ${formatTaxYearLabel(taxStart)}`,
      ...taxYearRange(taxStart)
    },
    {
      key: PRESET_KEYS.LAST_TAX_YEAR,
      label: `Tax year ${formatTaxYearLabel(taxStart - 1)}`,
      ...taxYearRange(taxStart - 1)
    },
    {
      key: PRESET_KEYS.THIS_YEAR,
      label: String(year),
      ...calendarYearRange(year)
    },
    {
      key: PRESET_KEYS.LAST_YEAR,
      label: String(year - 1),
      ...calendarYearRange(year - 1)
    }
  ];
}

/**
 * Which preset, if any, the current From/To pair is exactly. Compares the 'yyyy-MM-dd'
 * strings directly - no parsing, so no timezone can shift the answer, and a hand-typed
 * range that happens to equal a preset highlights it too.
 * @param {string} fromDate
 * @param {string} toDate
 * @param {Date} [today]
 * @returns {string | null} the matching preset's key, or null for a custom range
 */
export function getActivePresetKey(fromDate, toDate, today = new Date()) {
  const match = getDateRangePresets(today).find(
    preset => preset.from === fromDate && preset.to === toDate
  );
  return match ? match.key : null;
}
