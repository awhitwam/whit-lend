# WhitLend System Documentation

A comprehensive technical guide to how all parts of the lending system work together.

---

## Table of Contents
1. [Core Data Models](#1-core-data-models)
2. [Loan Lifecycle](#2-loan-lifecycle)
3. [Interest Calculation](#3-interest-calculation)
4. [Transaction System](#4-transaction-system)
5. [Investor System](#5-investor-system)
6. [Bank Reconciliation](#6-bank-reconciliation)
7. [Nightly Jobs](#7-nightly-jobs)
8. [Ledger & Reporting](#8-ledger--reporting)
9. [Import Systems](#9-import-systems)
10. [System Interconnections](#10-system-interconnections)

---

## 1. Core Data Models

### Primary Entities

#### Loans
The central entity storing all loan details.

| Field | Description |
|-------|-------------|
| `principal_amount` | Original loan amount |
| `net_disbursed` | Principal minus arrangement fee (actual funds sent) |
| `interest_rate` / `overridden_rate` | Annual interest rate |
| `duration` | Loan term in periods |
| `start_date` | Release/disbursement date |
| `status` | Live, Pending, Closed, Default, Restructured |
| `overpayment_credit` | Accumulated overpayments available for future use |

**Relationships:**
- Belongs to a Borrower (`borrower_id`)
- Uses a LoanProduct (`product_id`) for default settings
- Has many RepaymentSchedule entries
- Has many Transactions (Repayments, Disbursements)
- Can have Properties as security/collateral

#### Borrowers
Individuals or businesses receiving loans.

| Field | Description |
|-------|-------------|
| `name` | Full name or business name |
| `email`, `phone` | Contact details |
| `address`, `city`, `postcode` | Location |
| `status` | Active or Archived |

#### Investors
Capital providers funding the loan book.

| Field | Description |
|-------|-------------|
| `name`, `email`, `phone` | Contact details |
| `current_capital_balance` | Live balance (capital_in - capital_out) |
| `total_capital_contributed` | Historical sum of all capital_in |
| `total_interest_paid` | Sum of all interest credits posted |
| `accrued_interest` | Pending interest (used in manual mode) |
| `last_accrual_date` | When interest was last posted |
| `investor_product_id` | Links to interest calculation rules |

#### Loan Products
Templates defining loan terms and calculation methods.

| Field | Description |
|-------|-------------|
| `name` | Product name (e.g., "Standard Bridge") |
| `interest_rate` | Default annual rate |
| `interest_type` | Flat, Reducing, Interest-Only, Rolled-Up |
| `period` | Monthly or Weekly |
| `product_type` | Standard, Fixed Charge, Irregular Income |
| `interest_calculation` | period_based, monthly_first, daily |
| `interest_paid_in_advance` | If true, interest due at period START |

#### Investor Products
Define investor account types and interest rules.

| Field | Description |
|-------|-------------|
| `name` | Product name (e.g., "High Interest Saver") |
| `interest_rate_per_annum` | Annual interest rate |
| `interest_calculation_type` | automatic (system-driven) or manual |
| `interest_posting_frequency` | monthly, quarterly, annually |
| `interest_posting_day` | Day of month to post (1-28) |
| `min_balance_for_interest` | Minimum balance to earn interest |
| `min_balance_for_withdrawals` | Minimum balance to allow withdrawal |

#### Repayment Schedules
Generated payment schedule for each loan.

| Field | Description |
|-------|-------------|
| `due_date` | When payment is due |
| `principal_amount` | Principal portion due |
| `interest_amount` | Interest portion due |
| `total_due` | Sum of principal + interest |
| `principal_paid` | Principal actually paid |
| `interest_paid` | Interest actually paid |
| `status` | Pending, Partial, Paid, Overdue |
| `balance` | Remaining principal after this payment |

#### Transactions (Loan)
All loan-related cash flows.

| Field | Description |
|-------|-------------|
| `type` | Repayment or Disbursement |
| `amount` | Total transaction amount |
| `date` | Transaction date |
| `principal_applied` | Portion applied to principal |
| `interest_applied` | Portion applied to interest |
| `fees_applied` | Portion applied to fees |
| `reference` | External reference (bank ref, etc.) |
| `is_deleted` | Soft delete flag |

#### Investor Transactions
Capital movements for investors.

| Field | Description |
|-------|-------------|
| `type` | capital_in or capital_out |
| `amount` | Transaction amount |
| `date` | Transaction date |
| `reference` | External reference |
| `description` | Transaction description |

#### Investor Interest Ledger
Simple credit/debit ledger for interest tracking (replaced complex double-entry system).

| Field | Description |
|-------|-------------|
| `type` | credit (accrued) or debit (withdrawn) |
| `amount` | Interest amount |
| `date` | Entry date |
| `description` | Description of interest entry |
| `reference` | For bank reconciliation linking |

---

## 2. Loan Lifecycle

### Creation Flow

```
1. User selects Borrower (or creates new)
2. User selects Loan Product (determines default terms)
3. User enters: Principal, Arrangement Fee, Duration, Start Date
4. User can override interest rate if needed
5. System calculates: net_disbursed = principal - arrangement_fee
6. System generates repayment schedule
7. If start_date <= today: Status = Live
   If start_date > today: Status = Pending
8. Disbursement transaction created (if not Pending)
```

### Status Transitions

| From | To | Trigger |
|------|-----|---------|
| Pending | Live | Start date reached or manual activation |
| Live | Closed | Principal outstanding <= £0.01 |
| Live | Default | Manual marking for delinquent loans |
| Any | Restructured | Loan rolled into new restructured loan |

### Payment Recording

**Automatic Waterfall (Default)**
```
1. Sort schedule entries by due_date (oldest first)
2. For each unpaid/partial entry:
   a. Apply payment to interest_due first
   b. Apply remainder to principal_due
   c. Update entry status (Pending → Partial → Paid)
3. Handle any overpayment:
   - Option A: Credit to account (overpayment_credit)
   - Option B: Reduce future principal
```

**Manual Split**
```
User specifies exact amounts for:
- Interest allocation
- Principal allocation
System applies as specified to oldest entries first
```

### Schedule Regeneration

The schedule is regenerated whenever:
- A payment is recorded
- Loan parameters are edited (rate, duration, etc.)
- An adjustment is made

The calculation considers ALL historical transactions and recalculates forward.

---

## 3. Interest Calculation

### For Loans

#### Interest Types

**1. Flat Rate**
- Interest calculated once at loan start on original principal
- Formula: `(principal × rate/100) × (duration/periods_per_year)`
- Same interest amount each period
- Principal evenly distributed

**2. Reducing Balance**
- Interest calculated each period on remaining principal
- Uses amortization formula for equal total payments
- Interest portion decreases over time, principal increases

**3. Interest-Only**
- Only interest due during initial period
- Formula: `principal × rate/100 / periods_per_year`
- Principal due as balloon payment at end (or after IO period)

**4. Rolled-Up**
- All interest accrues until maturity
- Single payment at end: principal + all rolled interest
- Used for bridge financing where borrower has no income during term

#### Calculation Alignment Options

| Option | Behavior |
|--------|----------|
| `period_based` | Schedule aligns to loan start + N periods |
| `monthly_first` | All payments on 1st of month, pro-rated first period |
| `interest_paid_in_advance` | Interest due at START of period |

#### Daily Interest Accrual

For live interest calculations:
```
daily_rate = annual_rate / 100 / 365
daily_interest = principal_outstanding × daily_rate
```

### For Investors

#### Automatic Calculation (via Nightly Job)

```
1. Calculate days since last accrual
2. accrued = balance × (rate/100) / 365 × days
3. On posting_day: create credit entry in investor_interest
4. Reset: accrued_interest = 0, last_accrual_date = today
```

#### Manual Calculation

- User manually enters accrued interest amounts
- Creates credit entries in investor_interest directly
- No automatic posting

#### Posting Frequencies

| Frequency | Rule |
|-----------|------|
| Monthly | Post if >= 1 month since last posting |
| Quarterly | Post if >= 3 months since last posting |
| Annually | Post if >= 12 months since last posting |

---

## 4. Transaction System

### Loan Transaction Types

#### Repayment
Money received from borrower.

```javascript
{
  type: 'Repayment',
  amount: 1000,           // Total received
  principal_applied: 800, // Portion to principal
  interest_applied: 200,  // Portion to interest
  fees_applied: 0,        // Portion to fees
  date: '2025-01-15',
  reference: 'BANK-REF-123'
}
```

#### Disbursement
Money sent to borrower.

```javascript
{
  type: 'Disbursement',
  amount: 50000,              // Net amount sent
  principal_applied: 50000,   // Same as amount
  date: '2025-01-01',         // Loan start date
  notes: 'Initial loan disbursement'
}
```

### Investor Transaction Types

#### Capital In
Investor deposits funds.

```javascript
{
  type: 'capital_in',
  amount: 100000,
  date: '2025-01-01',
  reference: 'INV-DEPOSIT-001'
}
// Updates: current_capital_balance += amount
// Updates: total_capital_contributed += amount
```

#### Capital Out
Investor withdraws funds.

```javascript
{
  type: 'capital_out',
  amount: 10000,
  date: '2025-06-01',
  reference: 'INV-WITHDRAWAL-001'
}
// Updates: current_capital_balance -= amount
```

### Interest Ledger Entries

#### Credit (Interest Accrued)
```javascript
{
  type: 'credit',
  amount: 416.67,  // Monthly interest on £100k at 5%
  date: '2025-02-01',
  description: 'Interest accrued: 31 days at 5% p.a.'
}
```

#### Debit (Interest Withdrawn)
```javascript
{
  type: 'debit',
  amount: 416.67,
  date: '2025-02-15',
  description: 'Interest payment to investor'
}
```

---

## 5. Investor System

### Account Structure

```
Investor
├── InvestorProduct (interest rules)
├── InvestorTransactions (capital movements)
│   ├── capital_in entries
│   └── capital_out entries
└── investor_interest (interest ledger)
    ├── credit entries (accrued)
    └── debit entries (withdrawn)
```

### Balance Calculations

```javascript
// Capital Balance
current_capital_balance = SUM(capital_in) - SUM(capital_out)

// Total Interest (from ledger)
total_interest = SUM(credits) - SUM(debits)

// Available for Withdrawal
available = current_capital_balance - min_balance_for_withdrawals
```

### Interest Flow

```
Daily Accrual Calculation
         ↓
Stored temporarily in accrued_interest field
         ↓
On posting_day → Create credit entry in investor_interest
         ↓
Reset accrued_interest to 0
         ↓
Update total_interest_paid on investor
```

---

## 6. Bank Reconciliation

### Data Model

**Bank Statements** (imported bank transactions)
```javascript
{
  statement_date: '2025-01-15',
  description: 'FPI JOHN SMITH LOAN REPAY',
  amount: 1500.00,
  transaction_type: 'CRDT',  // Credit
  is_reconciled: false,
  external_reference: 'hash-of-date-amount-desc'
}
```

**Reconciliation Entries** (links bank to system)
```javascript
{
  bank_statement_id: 'uuid',
  loan_transaction_id: 'uuid',  // OR one of:
  investor_transaction_id: null,
  expense_id: null,
  interest_id: null,
  amount: 1500.00,
  reconciliation_type: 'loan_repayment'
}
```

### Reconciliation Types

| Type | Links To | Description |
|------|----------|-------------|
| `loan_repayment` | Transaction (Repayment) | Borrower payment received |
| `loan_disbursement` | Transaction (Disbursement) | Loan funds sent out |
| `investor_credit` | InvestorTransaction (capital_in) | Investor funds received |
| `investor_withdrawal` | InvestorTransaction (capital_out) | Investor funds returned |
| `investor_interest` | investor_interest (debit) | Interest paid to investor |
| `expense` | Expense | Business expense paid |
| `other_income` | OtherIncome | Miscellaneous income |
| `funds_returned` | None | Internal transfers/returned items |

### Matching Algorithm

```javascript
function calculateMatchScore(bankEntry, systemTransaction) {
  let score = 0;

  // Amount matching (most important)
  const amountDiff = Math.abs(bankEntry.amount - systemTransaction.amount);
  if (amountDiff / bankEntry.amount < 0.001) {  // Within 0.1%
    score += 0.5;
  }

  // Date proximity
  const daysDiff = Math.abs(daysBetween(bankEntry.date, systemTransaction.date));
  if (daysDiff === 0) score += 0.3;
  else if (daysDiff <= 3) score += 0.25;
  else if (daysDiff <= 7) score += 0.15;
  else if (daysDiff <= 14) score += 0.08;

  // Description keywords
  const keywordMatch = extractKeywords(bankEntry.description)
    .some(kw => systemTransaction.description?.includes(kw));
  if (keywordMatch) score += 0.2;

  return score;  // 0.0 to 1.0
}
```

### Pattern Learning

When a user manually reconciles, the system saves patterns:
```javascript
{
  description_pattern: ['LOAN', 'REPAY', 'SMITH'],
  amount_min: 1400,
  amount_max: 1600,
  match_type: 'loan_repayment',
  loan_id: 'uuid-of-matched-loan',
  confidence_score: 0.85,
  match_count: 5  // Increases with each match
}
```

Future imports use these patterns to suggest matches automatically.

---

## 7. Nightly Jobs

### Scheduled Tasks (2 AM UTC Daily)

#### Task 1: Post Investor Interest

```
For each Investor Product where:
  - interest_calculation_type = 'automatic'
  - today's day-of-month = interest_posting_day

For each linked Investor:
  1. Check if posting is due (based on frequency)
  2. Verify balance >= min_balance_for_interest
  3. Calculate: accrued = balance × rate/100/365 × days_since_last_posting
  4. Create credit entry in investor_interest
  5. Update Investor: accrued_interest = 0, last_accrual_date = today
```

#### Task 2: Update Loan Schedule Statuses

```
For each Repayment Schedule entry where:
  - status = 'Pending'
  - due_date < today
  - loan.status = 'Live'

Update status to:
  - 'Partial' if (principal_paid + interest_paid) > 0 but < total_due
  - 'Overdue' if nothing paid
```

#### Task 3: Recalculate Investor Balances (Weekly)

```
For each Investor:
  1. Sum all capital transactions
  2. Sum all interest ledger entries
  3. Compare to stored balances
  4. Correct if difference > £0.01
```

### Execution Logging

All job runs logged to `nightly_job_runs` table:
```javascript
{
  task_name: 'investor_interest',
  started_at: '2025-01-15T02:00:00Z',
  completed_at: '2025-01-15T02:00:15Z',
  status: 'success',
  processed: 50,
  succeeded: 48,
  failed: 0,
  skipped: 2,
  details: [/* per-investor results */]
}
```

---

## 8. Ledger & Reporting

### Unified Ledger View

The Ledger combines ALL financial transactions into a single timeline:

| Type | Source | Money In | Money Out |
|------|--------|----------|-----------|
| Repayment | Transaction (Repayment) | ✓ | |
| Disbursement | Transaction (Disbursement) | | ✓ |
| Investor Capital In | InvestorTransaction (capital_in) | ✓ | |
| Investor Capital Out | InvestorTransaction (capital_out) | | ✓ |
| Investor Interest Credit | investor_interest (credit) | ✓ | |
| Investor Interest Debit | investor_interest (debit) | | ✓ |
| Expense | Expense | | ✓ |
| Other Income | OtherIncome | ✓ | |

### Running Balance

```javascript
entries.forEach((entry, index) => {
  if (index === 0) {
    entry.balance = entry.amount_in - entry.amount_out;
  } else {
    entry.balance = entries[index-1].balance
      + entry.amount_in
      - entry.amount_out;
  }
});
```

### Reconciliation Status

Each ledger entry shows:
- Whether it's been reconciled
- Link to the bank statement
- Bank statement date and description

---

## 9. Import Systems

### LoanDisc Import

Imports loans from LoanDisc export CSV.

**Field Mapping:**
| CSV Column | System Field |
|------------|--------------|
| Loan Number | loan_number |
| Borrower | borrower.name |
| Principal | principal_amount |
| Interest Rate | interest_rate (converted to annual) |
| Duration | duration |
| Start Date | start_date |
| Status | status (mapped) |

**Status Mapping:**
| LoanDisc Status | System Status |
|-----------------|---------------|
| Current | Live |
| Fully Paid | Closed |
| Restructured | Restructured |
| Write-Off | Default |
| Past Maturity | Live |

**Post-Import:**
- Repayment schedule generated
- Disbursement transaction created (if not Pending)

### Investor Transaction Import

Imports capital movements from CSV.

**Field Mapping:**
| CSV Column | System Field |
|------------|--------------|
| Date | date |
| Account# | investor.account_number (for matching) |
| Type | type (deposit → capital_in, withdrawal → capital_out) |
| Debit/Credit | amount |
| Description | description |

**Interest Handling:**
- Interest accruals (credits) are **SKIPPED** - the nightly job handles these
- Only interest payments/withdrawals (debits) are imported

### Bank Statement Import

Supports multiple bank formats:
- **Allica Bank**: Date, TYPE, Amount, Description
- **Barclays Bank**: Date, Amount, Memo, Number

**Duplicate Prevention:**
- External reference generated from: date + amount + description
- Unique constraint prevents duplicate imports

---

## 10. System Interconnections

### Complete Flow: Loan Repayment

```
1. Bank Import
   └── Bank statement with £1000 credit uploaded

2. Bank Reconciliation
   └── User matches to loan repayment
   └── Reconciliation entry created

3. Transaction System
   └── Repayment transaction created
   └── Waterfall applies: £200 interest, £800 principal

4. Schedule Update
   └── Oldest unpaid schedule entry updated
   └── Status: Pending → Paid

5. Loan Update
   └── principal_paid += £800
   └── interest_paid += £200
   └── principal_outstanding -= £800

6. Ledger
   └── Entry appears with reconciliation status
   └── Balance updated
```

### Complete Flow: Investor Interest

```
1. Daily Calculation (Nightly Job)
   └── balance × rate/100/365 = daily interest

2. Accumulation
   └── accrued_interest field tracks pending amount

3. Posting (on interest_posting_day)
   └── Credit entry created in investor_interest
   └── accrued_interest reset to 0
   └── total_interest_paid updated

4. Withdrawal (User Action)
   └── Debit entry created in investor_interest
   └── InvestorTransaction (capital_out) if withdrawing capital too

5. Bank Reconciliation
   └── Match bank debit to investor_interest debit
   └── Reconciliation entry links them

6. Ledger
   └── Shows interest credit/debit entries
   └── Shows reconciliation status
```

### Data Scoping (Multi-Tenancy)

```
User Login
    ↓
Organization Selection
    ↓
setOrganizationIdGetter(currentOrgId)
    ↓
All API Calls: organization_id injected automatically
    ↓
Database RLS: WHERE organization_id IN (user_org_ids())
    ↓
Complete Data Isolation
```

---

## Key Formulas Reference

### Loan Interest

```javascript
// Daily interest
dailyInterest = principalOutstanding × (annualRate / 100) / 365

// Monthly interest (flat)
monthlyInterest = principal × (annualRate / 100) / 12

// Amortization payment (reducing balance)
P = Balance × [r(1+r)^n] / [(1+r)^n - 1]
// where r = monthly rate, n = remaining periods
```

### Investor Interest

```javascript
// Daily accrual
dailyAccrual = balance × (annualRate / 100) / 365

// Periodic posting
postedInterest = dailyAccrual × daysSinceLastPosting
```

### Loan Balances

```javascript
// Principal outstanding
principalOutstanding = principalAmount - SUM(principal_applied from all repayments)

// Interest outstanding
interestOutstanding = SUM(interest_amount from schedule) - SUM(interest_applied from repayments)

// Total repayable
totalRepayable = principalAmount + totalInterest + arrangementFee + exitFee
```

### Investor Balances

```javascript
// Capital balance
capitalBalance = SUM(capital_in) - SUM(capital_out)

// Interest balance
interestBalance = SUM(credits from investor_interest) - SUM(debits from investor_interest)
```

---

## File Reference

| System | Key Files |
|--------|-----------|
| Loan Management | `src/pages/NewLoan.jsx`, `src/pages/LoanDetails.jsx` |
| Payments | `src/components/loan/PaymentModal.jsx` |
| Calculations | `src/components/loan/LoanCalculator.jsx` |
| Investors | `src/pages/Investors.jsx`, `src/pages/InvestorDetails.jsx` |
| Bank Reconciliation | `src/pages/BankReconciliation.jsx` |
| Nightly Jobs | `supabase/functions/nightly-jobs/index.ts` |
| Ledger | `src/pages/Ledger.jsx` |
| Imports | `src/pages/ImportLoandisc.jsx`, `src/pages/ImportInvestorTransactions.jsx` |
| API Client | `src/api/dataClient.js` |
| Database | `supabase/migrations/*.sql` |
