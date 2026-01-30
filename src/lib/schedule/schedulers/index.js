/**
 * Schedulers Index
 *
 * Auto-registration of all schedulers.
 * Import this file to ensure all schedulers are registered with the registry.
 */

console.log('[Schedulers] === Starting scheduler registration ===');

// Import all schedulers - they self-register on import
import './IrregularIncomeScheduler.js';
import './FixedChargeScheduler.js';
import './RolledUpScheduler.js';
import './InterestOnlyScheduler.js';
import './FlatRateScheduler.js';
import './ReducingBalanceScheduler.js';
import './RentScheduler.js';
import './RollUpServicedScheduler.js';

console.log('[Schedulers] === All schedulers registered ===');

// Re-export scheduler classes for direct access if needed
export { IrregularIncomeScheduler } from './IrregularIncomeScheduler.js';
export { FixedChargeScheduler } from './FixedChargeScheduler.js';
export { RolledUpScheduler } from './RolledUpScheduler.js';
export { InterestOnlyScheduler } from './InterestOnlyScheduler.js';
export { FlatRateScheduler } from './FlatRateScheduler.js';
export { ReducingBalanceScheduler } from './ReducingBalanceScheduler.js';
export { RentScheduler } from './RentScheduler.js';
export { RollUpServicedScheduler } from './RollUpServicedScheduler.js';
