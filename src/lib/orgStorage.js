/**
 * Organization-scoped localStorage wrapper
 * All keys are automatically prefixed with current organization ID
 * to prevent data leakage between organizations
 */

/**
 * Get the organization-scoped storage key
 * @param {string} baseKey - The base key name
 * @returns {string} The org-scoped key (e.g., "uuid_baseKey")
 */
export function getOrgStorageKey(baseKey) {
  // Use sessionStorage for org ID (per-tab isolation)
  const orgId = sessionStorage.getItem('currentOrganizationId');
  if (!orgId) return baseKey; // Fallback for unauthenticated state
  return `${orgId}_${baseKey}`;
}

/**
 * Get an item from organization-scoped localStorage
 * @param {string} baseKey - The base key name
 * @returns {string|null} The stored value or null
 */
export function getOrgItem(baseKey) {
  return localStorage.getItem(getOrgStorageKey(baseKey));
}

/**
 * Set an item in organization-scoped localStorage
 * @param {string} baseKey - The base key name
 * @param {string} value - The value to store
 */
export function setOrgItem(baseKey, value) {
  localStorage.setItem(getOrgStorageKey(baseKey), value);
}

/**
 * Remove an item from organization-scoped localStorage
 * @param {string} baseKey - The base key name
 */
export function removeOrgItem(baseKey) {
  localStorage.removeItem(getOrgStorageKey(baseKey));
}

/**
 * Get a JSON object from organization-scoped localStorage
 * @param {string} baseKey - The base key name
 * @param {*} defaultValue - Default value if key doesn't exist or parse fails
 * @returns {*} The parsed JSON value or defaultValue
 */
export function getOrgJSON(baseKey, defaultValue = null) {
  try {
    const data = getOrgItem(baseKey);
    return data ? JSON.parse(data) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Set a JSON object in organization-scoped localStorage
 * @param {string} baseKey - The base key name
 * @param {*} value - The value to stringify and store
 */
export function setOrgJSON(baseKey, value) {
  setOrgItem(baseKey, JSON.stringify(value));
}
