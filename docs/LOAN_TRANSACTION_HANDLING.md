# Loan, Disbursement, Repayment & Interest Handling

Technical documentation for how the whit-lend system handles loans, transactions, and calculations.

---

## 1. LOAN CREATION FLOW

### 1.1 Creating a New Loan (NewLoan.jsx)

When a user creates a loan:

1. **User fills form** with:
   - Borrower (required)
   - Product (required) - determines interest type, rate, period
   - Principal amount
   - Arrangement fee (optional - deducted from disbursement)
   - Exit fee (optional - charged at settlement)
   - Duration (months/weeks)
   - Start date
   - Status ('Live' or 'Pending')

2. **System generates repayment schedule** based on:
   - Interest type (Flat, Reducing, Interest-Only, Rolled-Up)
   - Duration and period (Monthly/Weekly)
   - Principal and interest rate

3. **Creates initial Disbursement transaction** if loan status is 'Live':
   - Amount = `net_disbursed` OR `principal_amount - arrangement_fee`
   - Date = loan start date
   - Type = 'Disbursement'

### 1.2 Key Loan Fields

| Field | Description |
|-------|-------------|
| `principal_amount` | Original loan amount (gross) |
| `net_disbursed` | Amount actually given to borrower (after arrangement fee) |
| `arrangement_fee` | Upfront fee deducted from principal |
| `exit_fee` | Fee charged on settlement |
| `total_interest` | Calculated interest from schedule |
| `total_repayable` | Principal + Interest + Fees |
| `principal_paid` | Accumulated principal payments |
| `interest_paid` | Accumulated interest payments |

---

## 2. DISBURSEMENT HANDLING

### 2.1 Types of Disbursements

**Initial Disbursement**
- Created automatically when loan is released (status = 'Live')
- Amount = net_disbursed (principal minus arrangement fee)
- Represents the initial capital given to borrower

**Further Advances (Additional Drawdowns)**
- Additional capital given after initial loan
- Each creates a new 'Disbursement' transaction
- Increases total capital outstanding

### 2.2 How Principal is Calculated

The system uses **event-driven calculation** based on actual transactions:

```
Principal Outstanding = Total Disbursed - Total Principal Repaid

Where:
- Total Disbursed = Sum of ALL Disbursement transactions
- Total Principal Repaid = Sum of principal_applied from Repayment transactions
```

### 2.3 Distinguishing Initial vs Further Advances

In display logic (LoanDetails.jsx):
- Sort all Disbursement transactions by date
- First disbursement = "Initial Disbursement"
- Subsequent disbursements = "Further Advances"

```javascript
const allDisbursements = transactions
  .filter(t => t.type === 'Disbursement')
  .sort((a, b) => new Date(a.date) - new Date(b.date));

const initialDisbursement = allDisbursements[0];
const furtherAdvances = allDisbursements.slice(1);
```

---

## 3. REPAYMENT PROCESSING

### 3.1 Payment Recording Flow

1. User enters payment amount and date
2. System applies **waterfall logic** (or manual split)
3. Updates schedule rows with paid amounts
4. Updates loan totals (principal_paid, interest_paid)
5. Creates Transaction record

### 3.2 Waterfall Logic (Default)

Payments are applied in this order:

1. **Sort schedule rows** by due_date (oldest first)
2. For each unpaid/partial row:
   - **Pay interest first**: Apply payment to outstanding interest
   - **Then pay principal**: Apply remainder to outstanding principal
3. **Handle overpayment**: Credit or reduce principal

```
Payment $1000 → Schedule Row (due Jan 1):
  ├─ Interest due: $200 → Pay $200 (remaining: $800)
  ├─ Principal due: $500 → Pay $500 (remaining: $300)
  └─ Remainder $300 → Next schedule row or overpayment credit
```

### 3.3 Manual Split Mode

User can specify exact allocation:
- Interest amount to apply
- Principal amount to apply

Useful for specific accounting requirements.

### 3.4 Transaction Structure

```javascript
{
  loan_id: UUID,
  borrower_id: UUID,
  date: Date,
  type: 'Repayment',
  amount: 1000.00,           // Total payment
  principal_applied: 800.00,  // Applied to principal
  interest_applied: 200.00,   // Applied to interest
  fees_applied: 0,
  reference: 'BACS-12345',
  notes: 'Monthly payment'
}
```

---

## 4. INTEREST CALCULATION

### 4.1 Interest Types

**Flat Rate**
- Interest calculated on ORIGINAL principal only
- Same interest amount each period
- Total interest fixed at loan start

```
Total Interest = Principal × Annual Rate × (Duration / 12)
Interest Per Period = Total Interest / Duration
```

**Reducing Balance**
- Interest calculated on OUTSTANDING principal
- Interest decreases as principal is paid
- Standard amortizing loan

```
Each Period:
  Interest = Outstanding Principal × (Annual Rate / 12)
  Principal = Fixed Payment - Interest
```

**Interest-Only**
- Pay only interest during term
- All principal due at end (balloon)
- Lower initial payments

```
Periods 1 to N:
  Interest = Principal × (Annual Rate / 12)
  Principal = 0

Final Period:
  Principal = Full remaining balance (balloon)
```

**Rolled-Up**
- Interest accumulates throughout loan
- All interest + principal due at maturity
- Used for short-term bridging loans

```
Accumulation Period:
  Interest compounds each period
  No payments required

At Maturity:
  Principal + All Rolled-Up Interest due
```

### 4.2 Interest Calculation Method

**Monthly Fixed** (default):
- Uses 365/12 = 30.4167 days per month
- Consistent monthly amounts

**Daily**:
- Actual days in period
- More precise for partial months

### 4.3 Penalty Rates

Loans can have penalty rates applied after a specified date:

```javascript
if (loan.has_penalty_rate && today >= loan.penalty_rate_from) {
  useRate = loan.penalty_rate;  // Higher rate
} else {
  useRate = loan.interest_rate; // Normal rate
}
```

---

## 5. SCHEDULE GENERATION

### 5.1 When Schedules are Generated

1. **Loan creation** - Initial schedule
2. **Loan edit** - Parameters changed (rate, duration, principal)
3. **Regenerate Schedule** button - Manual trigger
4. **Auto-extend** - Extends schedule to current date

### 5.2 Schedule Regeneration Process

```
1. Fetch all non-deleted transactions
2. Calculate actual principal outstanding from transactions
3. Determine schedule duration:
   - Settled loan: Up to settlement date
   - Auto-extend: Up to today
   - Standard: Original duration
4. Generate new schedule rows
5. Delete old schedule
6. Create new schedule rows
7. Update loan totals
8. Reapply all existing payments
```

### 5.3 Auto-Extend Feature

When enabled:
- Schedule automatically extends beyond original duration
- Creates extension periods up to current date
- Useful for open-ended or rolling loans

### 5.4 Schedule Row Structure

```javascript
{
  loan_id: UUID,
  installment_number: 1,
  due_date: '2025-02-01',
  principal_amount: 500.00,   // Due this period
  interest_amount: 100.00,    // Due this period
  total_due: 600.00,
  balance: 5500.00,           // Principal remaining after
  principal_paid: 0,          // Paid so far
  interest_paid: 0,           // Paid so far
  status: 'Pending',          // 'Pending', 'Partial', 'Paid'
  is_extension_period: false
}
```

---

## 6. LOAN LIFECYCLE

```
┌─────────────────────────────────────────────────────────────┐
│                      LOAN CREATION                          │
├─────────────────────────────────────────────────────────────┤
│  User inputs → Schedule generated → Loan created            │
│                                   → Initial disbursement    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    LOAN ACTIVE (Live)                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │  Disbursements  │  │   Repayments    │                  │
│  │  (Initial +     │  │   (Principal +  │                  │
│  │   Further)      │  │    Interest)    │                  │
│  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                            │
│           ▼                    ▼                            │
│    Principal Outstanding = Disbursed - Principal Paid       │
│    Interest Outstanding = Scheduled - Interest Paid         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    LOAN CLOSURE                             │
├─────────────────────────────────────────────────────────────┤
│  When principal_paid >= principal AND                       │
│       interest_paid >= total_interest                       │
│  OR settlement payment recorded                             │
│  → Status = 'Closed'                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. KEY CALCULATIONS

### Principal Outstanding
```
= Sum(All Disbursements) - Sum(Repayment.principal_applied)
```

### Interest Outstanding (Scheduled)
```
= Sum(Schedule.interest_amount) - Sum(Schedule.interest_paid)
```

### Interest Outstanding (Live/Accrued)
```
= calculateAccruedInterest(loan, today) - loan.interest_paid
```
This accounts for daily accrual and is used for settlement quotes.

### Total Amount Due
```
= Principal Outstanding + Interest Outstanding + Exit Fee
```

---

## 8. SPECIAL LOAN TYPES

### Fixed Charge Facility
- No principal amount
- Fixed monthly charge instead of interest
- Schedule shows charges, not interest calculations

### Irregular Income Loan
- Multiple variable disbursements allowed
- No schedule generated
- Only tracks principal in/out

---

## 9. TRANSACTION TYPES SUMMARY

| Type | Creates When | Effect |
|------|--------------|--------|
| `Disbursement` | Loan release, Further advance | Increases principal outstanding |
| `Repayment` | Payment recorded | Reduces principal and/or interest outstanding |

---

## 10. IMPORTANT BEHAVIORS

1. **Event-Driven Schedules**: Schedules regenerate from actual transactions, not stored values. This preserves actual payment history while updating future projections.

2. **Soft Deletes**: Transactions use `is_deleted` flag. Deleted transactions are excluded from calculations but preserved for audit.

3. **Waterfall Order**: Always pays oldest installments first, interest before principal.

4. **Arrangement Fee Handling**: Deducted from principal at disbursement, so `net_disbursed = principal_amount - arrangement_fee`.

5. **Penalty Rate Split**: When penalty rate applies, interest is calculated at normal rate before penalty date and penalty rate after.

---

*Last updated: January 2026*
