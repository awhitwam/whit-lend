# Interest Calculation System Documentation

This document explains how interest is calculated throughout the whit-lend application, covering the key functions, data flow, and common issues.

## Overview

Interest calculation in whit-lend uses a **schedule-based approach** that:
1. Assigns transactions to schedule periods
2. Tracks principal balance through disbursements and repayments
3. Recalculates interest dynamically based on actual principal during each period
4. Handles penalty rates, mid-period capital changes, and rate overrides

## Key Functions

### 1. `calculateAccruedInterestWithTransactions()`
**Location:** `src/components/loan/LoanCalculator.jsx:1065`

**Purpose:** Main entry point for interest calculations. Used by:
- Dashboard (loan metrics)
- Loans list (Interest O/S column)
- LoanDetails header (Interest O/S box)

**Parameters:**
```javascript
calculateAccruedInterestWithTransactions(loan, transactions, asOfDate, schedule)
```

**Behavior:**
- If `schedule` is provided (and has entries), delegates to `calculateLoanInterestBalance()`
- If no schedule, falls back to day-by-day calculation (less accurate, doesn't handle rate changes)

**Returns:**
```javascript
{
  interestAccrued: number,    // Total interest due up to asOfDate
  interestPaid: number,       // Total interest received from transactions
  interestRemaining: number,  // interestAccrued - interestPaid (negative = overpaid)
  principalRemaining: number  // Outstanding principal balance
}
```

---

### 2. `calculateLoanInterestBalance()`
**Location:** `src/components/loan/LoanCalculator.jsx:1206`

**Purpose:** The core interest calculation function. Processes schedule periods up to `asOfDate` and dynamically recalculates interest based on actual principal.

**Key Algorithm Steps:**

#### Step 1: Filter Periods by Date
```javascript
if (dueDate > today) return; // Skip periods due after today
```
Only periods where `due_date <= asOfDate` are included in the calculation.

#### Step 2: Assign Transactions to Periods
Each repayment transaction is assigned to its **closest** schedule period by due date:
```javascript
sortedSchedule.forEach(scheduleRow => {
  const diff = Math.abs(txDate - dueDate);
  if (diff < closestDiff) {
    closestSchedule = scheduleRow;
  }
});
```

#### Step 3: Redistribute Excess Transactions
If a period has multiple transactions but adjacent periods are empty, excess transactions are redistributed (within 60-day range) to balance the assignments.

#### Step 4: Build Rows Array
Creates a unified array containing:
- **Disbursement rows** (type: 'disbursement' for initial, 'further_advance' for subsequent)
- **Schedule header rows** (type: 'schedule_header') - only for periods where `due_date <= today`

Rows are sorted by date, then by `sortOrder`:
- disbursement: 0
- further_advance: 1
- schedule_header: 2

#### Step 5: Process Each Row
For each row, tracks:
- `runningPrincipalBalance` - Updated after disbursements and principal repayments
- `runningInterestAccrued` - Accumulated interest due
- `runningInterestPaid` - Accumulated interest received
- `principalAtDate` Map - Records principal balance at each date for lookups

#### Step 6: Interest Calculation Per Period
For each schedule_header row:

1. **Find Principal at Period Start:**
   ```javascript
   const periodStartKey = row.periodStartDate.toISOString().split('T')[0];
   // Find the most recent principalAtDate entry <= periodStartKey
   for (const [dateKey, balance] of principalAtDate.entries()) {
     if (dateKey <= periodStartKey && dateKey > bestDate) {
       principalAtPeriodStart = balance;
     }
   }
   ```

2. **Determine Rate:**
   ```javascript
   const rateToUse = (loan.penalty_rate && loan.penalty_rate_from &&
                      new Date(loan.penalty_rate_from) <= periodEnd)
     ? loan.penalty_rate
     : loan.interest_rate;
   ```

3. **Calculate Interest:**
   - **Simple calculation** (no capital changes during period):
     ```javascript
     expectedInterest = principalAtPeriodStart * dailyRate * days;
     ```

   - **Segmented calculation** (capital changes during period):
     Splits the period into segments at each capital change, calculates interest for each segment at the relevant principal, then sums.

4. **Update Balances (CRITICAL ORDER):**
   ```javascript
   // 1. Accrue interest
   runningInterestAccrued += row.expectedInterest;

   // 2. Track interest paid from transactions
   runningInterestPaid += periodInterestPaid;

   // 3. Update principal balance for repayments
   runningPrincipalBalance -= periodPrincipalPaid;

   // 4. Record balance AFTER principal reduction (for next period's lookup)
   principalAtDate.set(row.date, runningPrincipalBalance);
   ```

**Returns:**
```javascript
{
  totalInterestDue: number,    // Sum of all expectedInterest
  totalInterestPaid: number,   // Sum of all interest_applied from transactions
  interestBalance: number,     // totalInterestDue - totalInterestPaid
  periods: [...]               // Per-period breakdown (for debugging)
}
```

---

### 3. `exportScheduleCalculationData()`
**Location:** `src/components/loan/LoanCalculator.jsx:1572`

**Purpose:** Exports detailed calculation data to CSV for analysis. Uses the same logic as `calculateLoanInterestBalance()` but returns more detailed per-period information.

**Used by:** LoanDetails CSV export ("Export Schedule Calculation" button)

---

## Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│   Dashboard     │────▶│ calculateAccrued │────▶│ calculateLoanInterest   │
│   Loans.jsx     │     │ InterestWith     │     │ Balance()               │
│   LoanDetails   │     │ Transactions()   │     │                         │
└─────────────────┘     └──────────────────┘     └─────────────────────────┘
        │                        │                          │
        │                        │                          ▼
        │                        │              ┌─────────────────────────┐
        │                        │              │ For each schedule period│
        │                        │              │ where due_date <= today │
        │                        │              ├─────────────────────────┤
        │                        │              │ 1. Find principal at    │
        │                        │              │    period start         │
        │                        │              │ 2. Determine rate       │
        │                        │              │    (standard/penalty)   │
        │                        │              │ 3. Calculate interest   │
        │                        │              │    (simple/segmented)   │
        │                        │              │ 4. Sum transactions     │
        │                        │              │ 5. Update balances      │
        │                        │              └─────────────────────────┘
        │                        │
        │                        ▼
        │              ┌──────────────────┐
        │              │ No schedule?     │
        │              │ Fall back to     │
        │              │ day-by-day calc  │
        │              └──────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Result                                    │
├─────────────────────────────────────────────────────────────────┤
│ interestAccrued    = Total interest due up to today              │
│ interestPaid       = Sum of interest_applied from repayments     │
│ interestRemaining  = interestAccrued - interestPaid              │
│                      (negative value = borrower has overpaid)    │
│ principalRemaining = principal + disbursements - principal_paid  │
└─────────────────────────────────────────────────────────────────┘
```

## Important Concepts

### Period Date Ranges
Each schedule period covers a date range:
- **Period Start:** Previous period's due date (or loan start date for period 1)
- **Period End:** This period's due date

Example for Period 11:
- Period 10 due date: 2020-05-01
- Period 11 due date: 2020-06-01
- Period 11 date range: 2020-05-01 to 2020-06-01 (30/31 days)

### Principal Tracking
The `principalAtDate` Map stores principal balance at each date:
```javascript
principalAtDate = {
  '2019-08-13': 50000,  // Initial disbursement
  '2020-05-01': 50000,  // Period 10 end (before repayment)
  '2020-06-01': 30000,  // Period 11 end (after £20k repayment)
  ...
}
```

When calculating Period 12's interest:
1. Look up principal at period start (2020-06-01)
2. Find most recent entry ≤ 2020-06-01 → £30,000
3. Calculate interest on £30,000

### Segmented Interest Calculation
When capital changes (repayments or further advances) occur mid-period:

Example: Period 11 (May 1 - June 1) with £20k repayment on May 15:
```
Segment 1: May 1 - May 15 (14 days) at £50,000 principal
Segment 2: May 15 - June 1 (17 days) at £30,000 principal

Interest = (50000 × 0.10/365 × 14) + (30000 × 0.10/365 × 17)
         = 191.78 + 139.73
         = 331.51
```

### Penalty Rates
If `loan.penalty_rate` and `loan.penalty_rate_from` are set:
```javascript
const rateToUse = (new Date(loan.penalty_rate_from) <= periodEnd)
  ? loan.penalty_rate   // Use higher penalty rate
  : loan.interest_rate; // Use standard rate
```

---

## Common Issues and Debugging

### Issue 1: UI and CSV Showing Different Values
**Cause:** The `principalAtDate` map was being updated BEFORE processing principal repayments, so subsequent periods would see the wrong principal.

**Fix (January 2026):** Moved `principalAtDate.set()` to AFTER the principal reduction:
```javascript
// WRONG (old code):
principalAtDate.set(row.date, runningPrincipalBalance); // Records BEFORE repayment
runningPrincipalBalance -= periodPrincipalPaid;

// CORRECT (fixed code):
runningPrincipalBalance -= periodPrincipalPaid;
principalAtDate.set(row.date, runningPrincipalBalance); // Records AFTER repayment
```

### Issue 2: Interest Shows Wrong Value on Loans List
**Possible Causes:**
1. Schedule data not loaded yet (check `isLoadingSchedules`)
2. Schedule `loan_id` type mismatch (string vs UUID)
3. Falling back to day-by-day calculation (no schedule passed)

**Debug:** Check console logs:
```javascript
console.log(`[Loans.jsx FINAL] Loan ${loan.loan_number}:`, {
  scheduleLength: loanSchedule.length,
  // If 0, schedule not matching
});
```

### Issue 3: Interest Calculation Ignores Rate Changes
**Cause:** Using fallback day-by-day calculation instead of schedule-based.

**Fix:** Ensure schedule is passed to `calculateAccruedInterestWithTransactions()`:
```javascript
// WRONG:
calculateAccruedInterestWithTransactions(loan, transactions, new Date());

// CORRECT:
calculateAccruedInterestWithTransactions(loan, transactions, new Date(), schedule);
```

---

## CSV Export Comparison Feature

The CSV export includes a comparison section showing both calculations:
```
=== SUMMARY ===
...
--- CSV Export Calculation (exportScheduleCalculationData) ---
Interest Due (CSV): 20613.70
Interest Received (CSV): 20990.86
Interest O/S (CSV): -377.16

--- UI Header Calculation (calculateLoanInterestBalance) ---
Interest Due (UI): 20613.70
Interest Paid (UI): 20990.86
Interest O/S (UI): -377.16

--- Comparison ---
Values Match?: YES
```

If values don't match, the per-period comparison section shows which periods differ:
```
=== PER-PERIOD COMPARISON ===
Period,Due Date,Days,CSV Principal,UI Principal,CSV Interest,UI Interest,Diff
12,2020-07-01,29,30000,50000,238.36,397.26,158.90
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/components/loan/LoanCalculator.jsx` | Core interest calculation functions |
| `src/pages/LoanDetails.jsx` | CSV export with comparison feature |
| `src/pages/Loans.jsx` | Loans list Interest O/S column |
| `src/pages/Dashboard.jsx` | Dashboard interest metrics |
| `src/components/loan/RepaymentScheduleTable.jsx` | Schedule display (also calculates for display) |
| `src/components/loan/LoanScheduleManager.jsx` | Schedule regeneration |

---

## Testing Interest Calculations

To verify interest calculations:

1. **Export CSV** from LoanDetails page
2. Check the **"Values Match?"** row in the summary
3. If NO, check the **"PER-PERIOD COMPARISON"** section for specific mismatches
4. Look at:
   - Principal values (should match between CSV and UI)
   - Days in period (should be correct number)
   - Calculation method (simple vs segmented)
   - Capital changes (if any)

---

## Key Formulas

### Simple Interest (no capital changes)
```
Interest = Principal × (Annual Rate / 100 / 365) × Days
```

### Daily Rate
```
dailyRate = annualRate / 100 / 365
```

### Interest Balance
```
Interest Balance = Interest Due - Interest Paid
```
- Positive = borrower owes interest
- Negative = borrower has overpaid (credit)
