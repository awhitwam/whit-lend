/**
 * Password Validation Utility
 *
 * Centralized password validation rules and strength calculation.
 * Used by Login, ResetPassword, and AcceptInvitation pages.
 */

// Password validation rules
export const PASSWORD_RULES = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?'
};

// Individual rule checkers
export const checkMinLength = (password) => password.length >= PASSWORD_RULES.minLength;
export const checkUppercase = (password) => /[A-Z]/.test(password);
export const checkLowercase = (password) => /[a-z]/.test(password);
export const checkNumber = (password) => /[0-9]/.test(password);
export const checkSpecialChar = (password) => {
  const specialRegex = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/;
  return specialRegex.test(password);
};

/**
 * Get all validation results for a password
 * @param {string} password - The password to validate
 * @returns {Object} Object with boolean for each rule
 */
export const getPasswordValidation = (password) => ({
  minLength: checkMinLength(password),
  hasUppercase: checkUppercase(password),
  hasLowercase: checkLowercase(password),
  hasNumber: checkNumber(password),
  hasSpecialChar: checkSpecialChar(password)
});

/**
 * Check if password meets all requirements
 * @param {string} password - The password to validate
 * @returns {boolean} True if all requirements are met
 */
export const isPasswordValid = (password) => {
  const validation = getPasswordValidation(password);
  return Object.values(validation).every(Boolean);
};

/**
 * Get first failed validation message (for error display)
 * @param {string} password - The password to validate
 * @returns {string|null} First error message or null if valid
 */
export const getPasswordError = (password) => {
  if (!checkMinLength(password)) return 'Password must be at least 8 characters';
  if (!checkUppercase(password)) return 'Password must contain at least one uppercase letter';
  if (!checkLowercase(password)) return 'Password must contain at least one lowercase letter';
  if (!checkNumber(password)) return 'Password must contain at least one number';
  if (!checkSpecialChar(password)) return 'Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)';
  return null;
};

/**
 * Calculate password strength as a percentage (0-100)
 * @param {string} password - The password to evaluate
 * @returns {number} Strength score 0-100
 */
export const calculatePasswordStrength = (password) => {
  if (!password) return 0;

  let score = 0;
  const maxScore = 7;

  // Base requirements (each worth 1 point)
  if (checkMinLength(password)) score += 1;
  if (checkUppercase(password)) score += 1;
  if (checkLowercase(password)) score += 1;
  if (checkNumber(password)) score += 1;
  if (checkSpecialChar(password)) score += 1;

  // Bonus points
  if (password.length >= 12) score += 1;  // Extra length bonus
  if ((password.match(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/g) || []).length >= 2) score += 1;  // Multiple special chars

  return Math.round((score / maxScore) * 100);
};

/**
 * Get strength level based on score
 * @param {string} password - The password to evaluate
 * @returns {'weak'|'medium'|'strong'} Strength level
 */
export const getStrengthLevel = (password) => {
  const strength = calculatePasswordStrength(password);
  if (strength < 50) return 'weak';
  if (strength < 80) return 'medium';
  return 'strong';
};

/**
 * Get strength label for display
 * @param {string} password - The password to evaluate
 * @returns {string} Capitalized strength label
 */
export const getStrengthLabel = (password) => {
  const level = getStrengthLevel(password);
  return level.charAt(0).toUpperCase() + level.slice(1);
};
