/**
 * Centralized formatting utilities
 *
 * This module provides consistent formatting functions used throughout the application.
 * Import from here instead of defining locally to avoid duplication.
 */

/**
 * Format a number as currency (GBP by default)
 * @param {number|string} amount - The amount to format
 * @param {string} currency - Currency code (default: 'GBP')
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount, currency = 'GBP') {
  const num = parseFloat(amount) || 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

/**
 * Format a number as currency, with option to suppress zero values
 * @param {number|string} value - The value to format
 * @param {boolean} suppressZero - If true, returns '-' for zero values
 * @returns {string} Formatted currency string or '-'
 */
export function formatCurrencyOrDash(value, suppressZero = false) {
  const num = parseFloat(value) || 0;
  if (suppressZero && num === 0) return '-';
  return formatCurrency(num);
}

/**
 * Format a date string or Date object
 * @param {string|Date} date - The date to format
 * @param {string} formatStr - Format string (default: 'dd/MM/yyyy')
 * @returns {string} Formatted date string
 */
export function formatDate(date, formatStr = 'dd/MM/yyyy') {
  if (!date) return '';
  try {
    const { format, parseISO } = require('date-fns');
    const dateObj = typeof date === 'string' ? parseISO(date) : date;
    return format(dateObj, formatStr);
  } catch {
    return String(date);
  }
}

/**
 * Format a percentage value
 * @param {number} value - The percentage value
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted percentage string
 */
export function formatPercentage(value, decimals = 2) {
  const num = parseFloat(value) || 0;
  return `${num.toFixed(decimals)}%`;
}
