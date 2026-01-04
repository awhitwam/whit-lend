/**
 * Schedule-Aware Matching for Bank Reconciliation v2
 *
 * Matches bank entries against loan repayment schedules to find
 * the most likely loan and payment allocation.
 */

/**
 * Calculate similarity between two strings
 */
function stringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 100;

  // Simple word overlap
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return Math.round((intersection.length / union.size) * 100);
}

/**
 * Find matching schedules for a bank entry
 * Returns array of { loan, schedule, score } sorted by score descending
 */
export function findMatchingSchedules(entry, loans, schedules) {
  const paymentAmount = Math.abs(entry.amount);
  const entryDate = entry.statement_date ? new Date(entry.statement_date) : new Date();
  const description = (entry.description || '') + ' ' + (entry.counterparty || '');

  const matches = [];

  for (const loan of loans) {
    // Only consider Live loans
    if (loan.status !== 'Live') continue;

    let score = 0;
    let bestSchedule = null;
    let scheduleScore = 0;

    // Score based on borrower name match
    const nameSimilarity = stringSimilarity(description, loan.borrower_name);
    if (nameSimilarity > 50) {
      score += nameSimilarity * 0.5; // Up to 50 points
    }

    // Find matching schedules for this loan
    const loanSchedules = schedules.filter(s =>
      s.loan_id === loan.id &&
      (s.status === 'Pending' || s.status === 'Overdue')
    );

    for (const schedule of loanSchedules) {
      let thisScheduleScore = 0;
      const expectedTotal = (schedule.principal_amount || 0) + (schedule.interest_amount || 0);

      // Amount match scoring
      if (expectedTotal > 0) {
        const amountDiff = Math.abs(paymentAmount - expectedTotal) / expectedTotal;

        if (amountDiff < 0.01) {
          // Exact match (within 1%)
          thisScheduleScore += 30;
        } else if (amountDiff < 0.05) {
          // Very close (within 5%)
          thisScheduleScore += 25;
        } else if (amountDiff < 0.1) {
          // Close (within 10%)
          thisScheduleScore += 15;
        } else if (amountDiff < 0.2) {
          // Somewhat close (within 20%)
          thisScheduleScore += 5;
        }
      }

      // Date proximity scoring
      if (schedule.due_date) {
        const dueDate = new Date(schedule.due_date);
        const daysDiff = Math.abs((entryDate - dueDate) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 3) {
          thisScheduleScore += 20;
        } else if (daysDiff <= 7) {
          thisScheduleScore += 15;
        } else if (daysDiff <= 14) {
          thisScheduleScore += 10;
        } else if (daysDiff <= 30) {
          thisScheduleScore += 5;
        }
      }

      // Overdue bonus (more likely to be this payment)
      if (schedule.status === 'Overdue') {
        thisScheduleScore += 10;
      }

      if (thisScheduleScore > scheduleScore) {
        scheduleScore = thisScheduleScore;
        bestSchedule = schedule;
      }
    }

    score += scheduleScore;

    // Minimum threshold
    if (score >= 20) {
      matches.push({
        loan,
        schedule: bestSchedule,
        score: Math.min(100, score)
      });
    }
  }

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Detect payment type based on amount vs schedule
 */
export function detectPaymentType(paymentAmount, schedule) {
  if (!schedule) return { type: 'unknown', label: 'Unknown' };

  const expectedTotal = (schedule.principal_amount || 0) + (schedule.interest_amount || 0);
  const interestOnly = schedule.interest_amount || 0;

  const diff = paymentAmount - expectedTotal;
  const pct = expectedTotal > 0 ? diff / expectedTotal : 0;

  // Exact match
  if (Math.abs(pct) < 0.01) {
    return { type: 'exact', label: 'Exact Match', color: 'green' };
  }

  // Interest-only payment
  if (Math.abs(paymentAmount - interestOnly) < interestOnly * 0.05) {
    return { type: 'interest_only', label: 'Interest Only', color: 'blue' };
  }

  // Overpayment
  if (pct > 0.05) {
    const extraAmount = diff;
    return {
      type: 'overpayment',
      label: 'Overpayment',
      color: 'blue',
      extra: extraAmount
    };
  }

  // Partial payment
  if (pct < -0.05) {
    const shortfall = Math.abs(diff);
    return {
      type: 'partial',
      label: 'Partial Payment',
      color: 'amber',
      shortfall
    };
  }

  // Close match
  return { type: 'close', label: 'Close Match', color: 'slate' };
}

/**
 * Calculate suggested split based on schedule and payment amount
 */
export function calculateSuggestedSplit(paymentAmount, schedule, loan) {
  if (!schedule) {
    // No schedule - need to calculate based on accrued interest
    return {
      principal: paymentAmount,
      interest: 0,
      fees: 0,
      isEstimated: true
    };
  }

  const expectedPrincipal = schedule.principal_amount || 0;
  const expectedInterest = schedule.interest_amount || 0;
  const expectedTotal = expectedPrincipal + expectedInterest;

  // Exact or close match - use schedule amounts
  if (Math.abs(paymentAmount - expectedTotal) < expectedTotal * 0.05) {
    return {
      principal: expectedPrincipal,
      interest: expectedInterest,
      fees: 0,
      isEstimated: false
    };
  }

  // Overpayment - extra goes to principal
  if (paymentAmount > expectedTotal) {
    const extra = paymentAmount - expectedTotal;
    return {
      principal: expectedPrincipal + extra,
      interest: expectedInterest,
      fees: 0,
      isEstimated: false,
      note: `Extra ${extra.toFixed(2)} applied to principal`
    };
  }

  // Underpayment - pay interest first
  if (paymentAmount < expectedTotal) {
    if (paymentAmount <= expectedInterest) {
      return {
        principal: 0,
        interest: paymentAmount,
        fees: 0,
        isEstimated: false,
        note: 'Interest payment only (shortfall on principal)'
      };
    }
    return {
      principal: paymentAmount - expectedInterest,
      interest: expectedInterest,
      fees: 0,
      isEstimated: false,
      note: 'Full interest paid, partial principal'
    };
  }

  return {
    principal: expectedPrincipal,
    interest: expectedInterest,
    fees: 0,
    isEstimated: false
  };
}

/**
 * Validate split against loan balance
 */
export function validateSplit(split, loan) {
  const errors = [];
  const warnings = [];

  if (!loan) {
    errors.push('No loan selected');
    return { errors, warnings, isValid: false };
  }

  // Check principal
  if (split.principal > (loan.outstanding_balance || 0)) {
    errors.push(`Principal (${split.principal.toFixed(2)}) exceeds outstanding balance (${(loan.outstanding_balance || 0).toFixed(2)})`);
  }

  // Check interest (warning if significantly over accrued)
  if (loan.accrued_interest !== undefined && split.interest > loan.accrued_interest * 1.1) {
    warnings.push(`Interest payment exceeds accrued interest by more than 10%`);
  }

  // Check loan status
  if (loan.status === 'Closed' || loan.status === 'Written Off') {
    errors.push(`Loan is ${loan.status.toLowerCase()}`);
  }

  return {
    errors,
    warnings,
    isValid: errors.length === 0
  };
}
