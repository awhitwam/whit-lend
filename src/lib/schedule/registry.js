/**
 * Scheduler Registry
 *
 * Central registry for all loan schedule generators.
 * Schedulers register themselves on import, making them automatically
 * available for selection in product configuration.
 */

const schedulerRegistry = new Map();

/**
 * Register a scheduler class with the registry
 *
 * @param {Class} SchedulerClass - A class extending BaseScheduler
 */
export function registerScheduler(SchedulerClass) {
  if (!SchedulerClass.id) {
    console.error('Scheduler must have static id property:', SchedulerClass);
    return;
  }

  if (schedulerRegistry.has(SchedulerClass.id)) {
    console.warn(`Scheduler ${SchedulerClass.id} already registered, skipping duplicate`);
    return;
  }

  schedulerRegistry.set(SchedulerClass.id, SchedulerClass);
  console.log(`Registered scheduler: ${SchedulerClass.id} (${SchedulerClass.displayName})`);
}

/**
 * Get a scheduler class by its ID
 *
 * @param {string} id - Scheduler ID (e.g., 'reducing_balance')
 * @returns {Class|undefined} The scheduler class or undefined if not found
 */
export function getScheduler(id) {
  return schedulerRegistry.get(id);
}

/**
 * Get all registered schedulers as metadata objects
 * Useful for populating dropdown lists in the UI
 *
 * @returns {Array<Object>} Array of scheduler metadata
 */
export function getAllSchedulers() {
  return Array.from(schedulerRegistry.values()).map(SchedulerClass => ({
    id: SchedulerClass.id,
    displayName: SchedulerClass.displayName,
    description: SchedulerClass.description,
    category: SchedulerClass.category,
    generatesSchedule: SchedulerClass.generatesSchedule,
    configSchema: SchedulerClass.configSchema,
    ViewComponent: SchedulerClass.ViewComponent,
    displayConfig: SchedulerClass.displayConfig,
    getSummaryString: SchedulerClass.getSummaryString
  }));
}

/**
 * Get schedulers filtered by category
 *
 * @param {string} category - Category to filter by ('standard', 'interest-only', 'special')
 * @returns {Array<Object>} Filtered array of scheduler metadata
 */
export function getSchedulersByCategory(category) {
  return getAllSchedulers().filter(s => s.category === category);
}

/**
 * Check if a scheduler ID is registered
 *
 * @param {string} id - Scheduler ID to check
 * @returns {boolean} True if registered
 */
export function hasScheduler(id) {
  return schedulerRegistry.has(id);
}

/**
 * Create an instance of a scheduler
 *
 * @param {string} id - Scheduler ID
 * @param {Object} config - Configuration to pass to the scheduler constructor
 * @returns {Object|null} Scheduler instance or null if not found
 */
export function createScheduler(id, config = {}) {
  const SchedulerClass = getScheduler(id);
  if (!SchedulerClass) {
    console.error(`Scheduler not found: ${id}`);
    return null;
  }
  return new SchedulerClass(config);
}

/**
 * Get the count of registered schedulers
 *
 * @returns {number} Number of registered schedulers
 */
export function getSchedulerCount() {
  return schedulerRegistry.size;
}

/**
 * Debug: List all registered scheduler IDs
 *
 * @returns {Array<string>} Array of scheduler IDs
 */
export function listSchedulerIds() {
  return Array.from(schedulerRegistry.keys());
}
