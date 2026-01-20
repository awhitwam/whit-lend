# WhitLend Application Analysis & Optimization Report

**Generated:** January 2025
**Last Updated:** January 2025
**Purpose:** Comprehensive analysis of codebase architecture, duplication, and optimization opportunities

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Completed Optimizations](#completed-optimizations)
3. [Loan Calculator Architecture](#part-1-loan-calculator-architecture)
4. [Code Duplication Analysis](#part-2-code-duplication-analysis)
5. [Performance Optimizations](#part-3-performance-optimizations)
6. [Recommended Action Plan](#part-4-recommended-action-plan)

---

## Executive Summary

This document provides a comprehensive analysis of the WhitLend application, covering:
- Loan Calculator architecture and module interfaces
- Code duplication opportunities
- Performance optimizations (N+1 queries, God components)
- Prioritized action plan with estimated effort

**Key Findings:**
- ~~`formatCurrency` duplicated 10+ times across 69 files~~ ✅ **FIXED**
- Token encryption duplicated across 4 Edge Functions
- LoanDetails.jsx is a 2,750-line "God component" with 37 useState declarations
- N+1 query patterns in property/valuation fetching
- Missing React Query staleTime configuration causing unnecessary refetches

---

## Completed Optimizations

### ✅ formatCurrency Consolidation (January 2025)

**Created:** `src/lib/formatters.js` - Centralized formatting utilities

**Updated Files:**
| File | Change |
|------|--------|
| `src/components/loan/LoanCalculator.jsx` | Now imports and re-exports from formatters.js |
| `src/components/loan/LoanScheduleManager.jsx` | Now imports and re-exports from formatters.js |
| `src/components/loan/EditLoanModal.jsx` | Removed 2 duplicate local definitions |
| `src/components/receipts/ReceiptEntryContent.jsx` | Now imports from formatters.js |
| `src/components/receipts/BankEntryPicker.jsx` | Now imports from formatters.js |
| `src/components/receipts/cells/AllocationCell.jsx` | Now imports from formatters.js |
| `src/components/receipts/cells/DateAmountCell.jsx` | Now imports from formatters.js |
| `src/components/receipts/cells/LoanCell.jsx` | Now imports from formatters.js |
| `src/components/receipts/cells/LoanAllocationCell.jsx` | Now imports from formatters.js |
| `src/lib/letterGenerator.js` | Now imports from formatters.js |

**Available Functions in `src/lib/formatters.js`:**
```javascript
formatCurrency(amount, currency = 'GBP')      // Standard currency formatting
formatCurrencyOrDash(value, suppressZero)     // Currency with dash option for zeros
formatDate(date, formatStr = 'dd/MM/yyyy')    // Date formatting
formatPercentage(value, decimals = 2)         // Percentage formatting
```

**Backward Compatibility:** `LoanCalculator.jsx` and `LoanScheduleManager.jsx` re-export `formatCurrency` so existing imports from those modules continue to work.

---

### ✅ Edge Function Shared Utilities Consolidation (January 2025)

**Created shared utilities in `supabase/functions/_shared/`:**

| File | Purpose |
|------|---------|
| `crypto.ts` | `encryptToken()` and `decryptToken()` functions for OAuth token storage |
| `cors.ts` | CORS headers, `jsonResponse()`, `errorResponse()`, `handleCors()` helpers |
| `tokenManagement.ts` | `refreshTokenIfNeeded()` and `getUserTokens()` for Google OAuth token management |

**Updated Edge Functions:**
| Function | Changes |
|----------|---------|
| `google-drive-auth` | Now imports from `_shared/crypto.ts` and `_shared/cors.ts` |
| `google-drive-upload` | Now imports from `_shared/tokenManagement.ts` and `_shared/cors.ts` |
| `google-drive-files` | Now imports from `_shared/tokenManagement.ts` and `_shared/cors.ts` |
| `google-drive-folders` | Now imports from `_shared/tokenManagement.ts` and `_shared/cors.ts` |

**Benefits:**
- Eliminated ~200 lines of duplicated code across 4 Edge Functions
- Single source of truth for token encryption/decryption logic
- Consistent error response formatting across all endpoints
- Easier maintenance - changes to token refresh logic only need to be made in one place

**Deployment Note:** After deploying, run:
```bash
supabase functions deploy google-drive-auth
supabase functions deploy google-drive-upload
supabase functions deploy google-drive-files
supabase functions deploy google-drive-folders
```

---

## Part 1: Loan Calculator Architecture

### Core Modules

| File | Purpose | Lines |
|------|---------|-------|
| `src/components/loan/LoanCalculator.jsx` | Main calculator (interest, payments, settlement) | ~2,750 |
| `src/lib/loanCalculations.js` | Shared utilities (roll-up, net disbursed) | ~50 |
| `src/lib/interestCalculation.js` | Investor account interest | ~100 |
| `src/lib/schedule/` | Modular scheduler system | 8 schedulers |

### Key Exported Functions from LoanCalculator.jsx

| Function | Purpose |
|----------|---------|
| `generateRepaymentSchedule()` | Generate schedule with multiple interest types |
| `calculateLoanSummary()` | Calculate totals: principal, interest, repayable |
| `applyPaymentWaterfall()` | Apply payment (interest -> principal) |
| `calculateAccruedInterest()` | Calculate accrued interest to date |
| `calculateAccruedInterestWithTransactions()` | Accrued interest with transaction ledger |
| `calculateLoanInterestBalance()` | Sophisticated 2-pass transaction assignment |
| `calculateSettlementAmount()` | Settlement with penalty rates |
| `queueBalanceCacheUpdate()` | Fire-and-forget async cache update |
| `updateAllLoanBalanceCaches()` | Bulk update with progress callback |
| `formatCurrency()` | Format amount as GBP |

### Scheduler System (Plugin-Based Registry)

The system uses a plugin-based scheduler registry with 8 registered schedulers extending `BaseScheduler`:

| Scheduler | Category | Description |
|-----------|----------|-------------|
| `reducing_balance` | standard | Standard amortizing with principal + interest |
| `flat_rate` | standard | Interest on original principal throughout |
| `interest_only` | interest-only | Interest payments, balloon at end |
| `rolled_up` | interest-only | Interest compounds, balloon at end |
| `roll_up_serviced` | interest-only | Roll-up period then monthly serviced |
| `fixed_charge` | special | Fixed monthly fee regardless of balance |
| `irregular_income` | special | No schedule, ad-hoc repayments |
| `rent` | special | Rent collection scheduling |

### Components/Pages That Use the Calculator

| Consumer | Functions Used |
|----------|----------------|
| `src/pages/LoanDetails.jsx` | Payment waterfall, schedule, balance caching |
| `src/pages/Loans.jsx` | `calculateAccruedInterestWithTransactions`, `updateAllLoanBalanceCaches`, `formatCurrency` |
| `src/components/loan/LoanApplicationForm.jsx` | `calculateRollUpAmount`, `generateRepaymentSchedule` |
| `src/components/loan/EditLoanModal.jsx` | `calculateRollUpAmount` |
| `src/components/loan/LoanScheduleManager.jsx` | Scheduler registry functions |
| `src/pages/Investors.jsx` | `calculateAccruedInterest` |
| `src/components/loan/RepaymentScheduleTable.jsx` | Display schedule data |

### Interest Calculation Flow

```
1. Loan created -> generateRepaymentSchedule() based on product type
2. Transaction recorded -> queueBalanceCacheUpdate() fires async
3. Balance cache updates: principal_remaining, interest_remaining, total_remaining
4. UI displays cached values for performance
5. "Refresh Balances" button -> updateAllLoanBalanceCaches() recalculates all
```

### Balance Caching Strategy

- **Cached fields on loan:** `principal_remaining`, `interest_remaining`, `total_remaining`, `interest_paid_to_date`, `principal_paid_to_date`
- Updated async after mutations (fire-and-forget pattern)
- Organization summary also cached in `organization_summary` table

### Interest Type Handling

**Rolled-Up (RolledUpScheduler):**
- Interest accrues but is NOT paid during term
- Single balloon entry at end with all rolled-up interest
- Monthly interest-only payments after original term ends
- Extension periods: 12 months default or until auto_extend date

**Roll-Up & Serviced (RollUpServicedScheduler):**
- Initial roll-up period (configurable: 6 months default)
- After roll-up: monthly serviced interest payments
- Interest calculated on (principal + rolled_up_amount)
- Optional compounding: interest on (principal + roll_up + unpaid_accrued)

**Interest-Only (InterestOnlyScheduler):**
- Only interest payments each period
- Full principal due as balloon on final period

**Fixed Charge (FixedChargeScheduler):**
- Fixed monthly fee (no interest calculation)
- Balance remains constant

---

## Part 2: Code Duplication Analysis

### ~~CRITICAL: formatCurrency Duplication (10+ copies)~~ ✅ RESOLVED

**Status:** Fixed in January 2025

All instances consolidated into `src/lib/formatters.js`. See [Completed Optimizations](#completed-optimizations) section for details.

---

### ~~CRITICAL: Edge Function Token Encryption (4 copies)~~ ✅ RESOLVED

**Status:** Fixed in January 2025

All instances consolidated into `supabase/functions/_shared/crypto.ts`. See [Completed Optimizations](#completed-optimizations) section for details.

---

### ~~CRITICAL: Token Refresh Logic (4 copies)~~ ✅ RESOLVED

**Status:** Fixed in January 2025

All instances consolidated into `supabase/functions/_shared/tokenManagement.ts`. See [Completed Optimizations](#completed-optimizations) section for details.

---

### ~~HIGH: CORS Headers (5+ copies)~~ ✅ RESOLVED

**Status:** Fixed in January 2025

All instances consolidated into `supabase/functions/_shared/cors.ts`. See [Completed Optimizations](#completed-optimizations) section for details.

---

### MEDIUM: Form State Patterns

Similar form state management in transaction forms:

**LoanRepaymentForm.jsx (lines 48-73):**
```javascript
const [selectedLoanId, setSelectedLoanId] = useState(initialLoan?.id || '');
const [amount, setAmount] = useState(initialAmount || '');
const [date, setDate] = useState(initialDate ? new Date(initialDate) : new Date());
const [reference, setReference] = useState(initialReference || '');
const [notes, setNotes] = useState('');
```

**Also in:**
- `src/components/transactions/InvestorCapitalForm.jsx:46-54`
- `src/components/transactions/InvestorInterestForm.jsx`
- `src/components/transactions/ExpenseEntryForm.jsx`

**Fix:** Create `src/hooks/useTransactionForm.js` custom hook

---

### MEDIUM: useQuery Patterns (222 occurrences)

Similar structure across 29 components:
```javascript
const { data: loans = [], isLoading } = useQuery({
  queryKey: ['loans', currentOrganization?.id],
  queryFn: () => api.entities.Loan.list(),
  enabled: !!currentOrganization,
});
```

**Fix:** Create specialized query hooks or `useDataClient.js`

---

## Part 3: Performance Optimizations

### CRITICAL: N+1 Query Patterns

**LoanDetails.jsx (lines 199-219):**
```javascript
// For EACH property link, makes 2 separate API calls
const enrichedLinks = await Promise.all(links.map(async (link) => {
  const [properties, valuations] = await Promise.all([
    api.entities.Property.filter({ id: link.property_id }),  // N+1!
    api.entities.ValueHistory.filter({ property_id: link.property_id })  // N+1!
  ]);
}));
```

**Impact:** If a loan has 5 properties, this creates 10 additional queries

**Fix:** Use Supabase `in()` filter to batch:
```javascript
const propertyIds = links.map(l => l.property_id);
const [properties, valuations] = await Promise.all([
  api.entities.Property.filter({ id: propertyIds }), // Single query
  api.entities.ValueHistory.filter({ property_id: propertyIds }) // Single query
]);
```

**Loans.jsx (lines 269-329):**
- Fetches `allLoanProperties`, `allProperties`, `allValueHistory` separately
- Joins in memory with O(n*m) complexity for LTV calculation

**Fix:** Create `loan_with_ltv_metrics` database view

---

### HIGH: God Component Problem

**LoanDetails.jsx:** 2,750 lines with:
- 37 useState declarations
- 48+ useQuery calls
- Payment, Edit, Settle, Schedule modals all inline
- Each state change triggers full component re-render

**Fix:** Extract into focused components:
```
LoanDetails.jsx (250 lines - layout only)
├── components/loan/LoanHeader.jsx
├── components/loan/tabs/ScheduleTab.jsx
├── components/loan/tabs/ActivityTab.jsx
├── components/loan/tabs/SecurityTab.jsx
├── components/loan/tabs/FilesTab.jsx
└── components/loan/modals/
    ├── PaymentModal.jsx
    ├── SettleModal.jsx
    ├── EditLoanModal.jsx
    └── RegenerateScheduleModal.jsx
```

---

### HIGH: Missing React.memo

Heavy components re-render unnecessarily:
- `RepaymentScheduleTable` - renders full schedule on any parent state change
- `TransactionList` - re-renders on every keystroke in search

**Fix:** Add `React.memo` with comparison functions:
```javascript
export default React.memo(RepaymentScheduleTable, (prev, next) => {
  return prev.schedule === next.schedule && prev.transactions === next.transactions;
});
```

---

### HIGH: Query Client Configuration

**Current (`src/lib/query-client.js`):**
```javascript
defaultOptions: {
  queries: {
    refetchOnWindowFocus: false,
    retry: 1,  // Low!
  },
}
```

**Missing:**
- `staleTime` (causes immediate refetches)
- `gcTime` (cache garbage collection)
- Smart retry logic

**Fix:**
```javascript
defaultOptions: {
  queries: {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000, // 5 min default
    gcTime: 10 * 60 * 1000, // 10 min
    retry: (failureCount, error) => {
      if (error?.status === 401 || error?.status === 403) return false;
      return failureCount < 3;
    },
  },
}
```

---

### MEDIUM: Overly Broad Cache Invalidation

**useReceiptDrafts.js (lines 215-220):**
```javascript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['transactions'] }); // ALL transactions!
  queryClient.invalidateQueries({ queryKey: ['loans'] }); // ALL loans!
}
```

**Fix:** Use selective invalidation:
```javascript
queryClient.invalidateQueries({
  queryKey: ['transactions', organizationId, loanId], // Specific
});
// Or direct cache update:
queryClient.setQueryData(['loan', loanId], (old) => ({ ...old, ...update }));
```

---

### MEDIUM: Bundle Size

| Dependency | Size | Issue |
|------------|------|-------|
| `moment` | 67KB | **DEPRECATED** - already using date-fns |
| `three` | 171KB | Only used in specific components, no code splitting |
| `recharts` | ~50KB | Not lazy loaded |
| `jspdf` + `html2canvas` | ~100KB | Not lazy loaded |

**Fixes:**
1. Remove `moment` from package.json (saves 67KB)
2. Implement lazy loading:
```javascript
const PDFGenerator = lazy(() => import('@/components/pdf/PDFGenerator'));
const Charts = lazy(() => import('@/components/charts/ChartsView'));
```

---

## Part 4: Recommended Action Plan

### Phase 1: Quick Wins

| # | Task | Files | Impact | Status |
|---|------|-------|--------|--------|
| 1 | Create `src/lib/formatters.js` | 1 new + 10 updates | Eliminate 10+ duplicates | ✅ **DONE** |
| 2 | Create Edge Function shared utilities | 3 new + 4 updates | Eliminate 12+ duplicates | ✅ **DONE** |
| 3 | Update query-client.js | 1 file | Reduce unnecessary refetches | Pending |
| 4 | Remove `moment` dependency | package.json | Save 67KB bundle | Pending |

---

### Phase 2: Performance Fixes (3-5 days)

| # | Task | Files | Impact |
|---|------|-------|--------|
| 5 | Fix N+1 in LoanDetails.jsx | 1 file | 80% fewer API calls |
| 6 | Add React.memo to heavy components | 3-5 files | Faster re-renders |
| 7 | Implement selective cache invalidation | 5-10 files | Fewer refetches |

---

### Phase 3: Architecture Improvements (1-2 weeks)

| # | Task | Files | Impact |
|---|------|-------|--------|
| 8 | Decompose LoanDetails.jsx | 10+ new files | Maintainability |
| 9 | Create specialized query hooks | 5-10 new hooks | Code reuse |
| 10 | Implement code splitting | 3-5 files | Faster initial load |

---

### Phase 4: Database Optimizations (optional)

| # | Task | Impact |
|---|------|--------|
| 11 | Create `loan_with_ltv_metrics` view | Faster LTV queries |
| 12 | Add database indexes | Query performance |

---

## Verification Checklist

After implementing changes:

- [ ] Run the app - Verify all pages load without errors
- [ ] Test loan calculator - Create loan, verify schedule generation
- [ ] Test payment flow - Record payment, verify waterfall allocation
- [ ] Check bundle size - Run `npm run build` and compare before/after
- [ ] Performance test - Load Loans page with 100+ loans, measure render time
- [ ] Run existing tests - `npm test` (if tests exist)

---

## Files to Modify (Summary)

| Priority | File | Change | Status |
|----------|------|--------|--------|
| HIGH | `src/lib/formatters.js` | CREATE - centralized formatters | ✅ **DONE** |
| HIGH | 10 files | UPDATE - import formatCurrency from formatters | ✅ **DONE** |
| HIGH | `supabase/functions/_shared/` | CREATE - shared utilities | ✅ **DONE** |
| HIGH | 4 Edge Functions | UPDATE - import shared utilities | ✅ **DONE** |
| HIGH | `src/lib/query-client.js` | UPDATE - add staleTime config | Pending |
| HIGH | `package.json` | UPDATE - remove moment | Pending |
| MEDIUM | `src/pages/LoanDetails.jsx` | REFACTOR - fix N+1, extract components | Pending |
| MEDIUM | `src/components/loan/RepaymentScheduleTable.jsx` | UPDATE - add React.memo | Pending |
| LOW | `src/pages/Loans.jsx` | REFACTOR - extract table logic to hook | Pending |

---

## Appendix: Calculator Function Details

### Interest Balance Calculation Algorithm

`calculateLoanInterestBalance()` uses a sophisticated 2-pass transaction assignment:

1. **Pass 1:** Assign each repayment to closest schedule period
2. **Pass 2:** Redistribute excess transactions from crowded periods to empty adjacent periods (within 60-day range)
3. Build capital events ledger
4. Calculate interest based on advance vs arrears timing
5. Return: `totalInterestDue`, `totalInterestPaid`, `interestBalance`

### Settlement Calculation

`calculateSettlementAmount()` handles:
- Penalty rate support (separate rate from penalty date onwards)
- Accrued interest to settlement date
- Principal remaining
- Exit fees
- Detailed breakdown for display

### Balance Cache Fields

Updated via `queueBalanceCacheUpdate()`:
- `principal_remaining` - Current principal balance
- `interest_remaining` - Current interest balance
- `total_remaining` - principal + interest + fees
- `interest_paid_to_date` - Total interest paid
- `principal_paid_to_date` - Total principal paid
