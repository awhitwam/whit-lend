/**
 * Schedule Generation Module
 *
 * Main entry point for the loan schedule generation system.
 * Import this module to access the scheduler registry and utilities.
 *
 * Usage:
 *   import { getScheduler, getAllSchedulers, createScheduler } from '@/lib/schedule';
 *
 *   // Get list of available schedulers for UI
 *   const schedulers = getAllSchedulers();
 *
 *   // Create a scheduler instance
 *   const scheduler = createScheduler('reducing_balance', config);
 *   const result = await scheduler.generateSchedule({ loan, product, options });
 */

// Import schedulers to ensure they're registered
import './schedulers/index.js';

// Re-export registry functions
export {
  registerScheduler,
  getScheduler,
  getAllSchedulers,
  getSchedulersByCategory,
  hasScheduler,
  createScheduler,
  getSchedulerCount,
  listSchedulerIds
} from './registry.js';

// Re-export base class for custom scheduler creation
export { BaseScheduler } from './BaseScheduler.js';

// Re-export utility functions
export {
  calculatePeriodInterest,
  calculateInterestForDays,
  calculatePrincipalAtDate,
  getDailyRate,
  getPeriodicRate,
  roundCurrency
} from './utils/interestCalculations.js';

export {
  advancePeriod,
  periodsToCoverDays,
  getPeriodsPerYear,
  getDaysInPeriod,
  formatDateISO,
  normalizeDate,
  getPeriodBoundaries,
  getFirstOfNextMonth,
  addMonths,
  addWeeks,
  differenceInDays,
  startOfMonth,
  format,
  parseISO
} from './utils/dateUtils.js';

export {
  calculateScheduleDuration,
  buildEventTimeline,
  getCapitalEventsInPeriod
} from './utils/durationCalculation.js';
