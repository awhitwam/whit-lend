# Nightly Jobs Documentation

Technical documentation for the automated nightly jobs Edge Function.

---

## 1. OVERVIEW

The nightly jobs system runs scheduled maintenance tasks across all organizations:

- **Investor Interest Posting**: Daily interest accrual for investors
- **Loan Schedule Updates**: Mark overdue/partial schedule entries
- **Balance Recalculation**: Reconcile investor balances

---

## 2. EDGE FUNCTION

### 2.1 Location
```
supabase/functions/nightly-jobs/
├── index.ts        # Main handler
└── config.toml     # Function configuration
```

### 2.2 Configuration

```toml
# config.toml
# Disable gateway JWT - function handles its own auth
verify_jwt = false
```

### 2.3 Authorization

The function supports two authorization methods:

**1. Cron Secret (Scheduled Runs)**
```
Header: x-cron-secret: <NIGHTLY_JOBS_CRON_SECRET>
```

**2. Super Admin JWT (Manual Runs)**
```
Header: Authorization: Bearer <user_jwt>
```
- JWT verified via `supabase.auth.getUser(token)`
- User must have `is_super_admin = true` in user_profiles

---

## 3. AVAILABLE TASKS

### 3.1 Investor Interest (`investor_interest`)

**Purpose:** Post daily interest transactions for all active investors

**Process:**
1. Fetch all active investors across all organizations
2. For each investor:
   - Get linked investor product
   - Calculate daily interest: `balance × (annual_rate / 365)`
   - Create `Interest Credit` transaction
   - Update investor totals
3. Skip if already posted today

**Transaction Created:**
```javascript
{
  investor_id: UUID,
  type: 'Interest Credit',
  amount: calculated_daily_interest,
  date: today,
  description: 'Daily interest posting',
  organization_id: investor.organization_id
}
```

### 3.2 Loan Schedules (`loan_schedules`)

**Purpose:** Update schedule entry statuses for overdue payments

**Process:**
1. Fetch all pending schedule entries with due dates in the past
2. For each entry:
   - If no payment received → Status = 'Overdue'
   - If partial payment received → Status = 'Partial'
3. Group updates by loan for logging

**Status Transitions:**
```
Pending → Overdue (if due_date < today AND no payment)
Pending → Partial (if due_date < today AND partial payment)
```

### 3.3 Recalculate Balances (`recalculate_balances`)

**Purpose:** Reconcile investor balances against actual transactions

**Process:**
1. Fetch all active investors
2. For each investor:
   - Sum all capital transactions (deposits - withdrawals)
   - Compare to stored `current_capital_balance`
   - If mismatch > £0.01, update the balance
3. Log corrections

**Calculation:**
```
Expected Balance = Capital In - Capital Out

Where:
- Capital In = Sum of deposits/contributions
- Capital Out = Sum of withdrawals
```

---

## 4. RUNNING JOBS

### 4.1 Manual Execution (Super Admin UI)

**Location:** Super Admin → Nightly Jobs tab

**Options:**
- Individual task buttons
- "Run All Nightly Jobs" for full run

### 4.2 API Call

```javascript
// Via Supabase client (handles auth)
const { data, error } = await supabase.functions.invoke('nightly-jobs', {
  body: { tasks: ['investor_interest', 'loan_schedules'] }
});
```

### 4.3 Scheduled Execution

Configure via Supabase cron or external scheduler:

```sql
-- Example: Run at 2 AM daily
SELECT cron.schedule(
  'nightly-jobs',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url:='https://your-project.supabase.co/functions/v1/nightly-jobs',
    headers:='{"x-cron-secret": "your-secret"}'::jsonb
  )
  $$
);
```

---

## 5. REQUEST/RESPONSE FORMAT

### 5.1 Request

```json
{
  "tasks": ["investor_interest", "loan_schedules", "recalculate_balances"]
}
```

If no body provided, defaults to: `["investor_interest", "loan_schedules"]`

### 5.2 Response

```json
{
  "timestamp": "2026-01-03T02:00:00.000Z",
  "duration_ms": 1523,
  "tasks": [
    {
      "task": "investor_interest",
      "processed": 45,
      "succeeded": 45,
      "failed": 0,
      "skipped": 0,
      "details": [...]
    },
    {
      "task": "loan_schedules",
      "processed": 120,
      "succeeded": 118,
      "failed": 2,
      "skipped": 0,
      "details": [...]
    }
  ],
  "summary": {
    "total_processed": 165,
    "total_succeeded": 163,
    "total_failed": 2,
    "total_skipped": 0
  }
}
```

---

## 6. JOB RUN LOGGING

### 6.1 Database Table

```sql
CREATE TABLE nightly_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  task_name TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'success', 'partial', 'failed'
  processed INTEGER DEFAULT 0,
  succeeded INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  details JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 6.2 Status Values

| Status | Meaning |
|--------|---------|
| `success` | All items processed successfully |
| `partial` | Some items succeeded, some failed |
| `failed` | All items failed or critical error |

---

## 7. CONSOLE LOGGING

The function produces detailed console logs:

```
[NightlyJobs] ************************************************************
[NightlyJobs] NIGHTLY JOBS STARTING
[NightlyJobs] Timestamp: 2026-01-03T02:00:00.000Z
[NightlyJobs] Tasks requested: investor_interest, loan_schedules
[NightlyJobs] ************************************************************

[NightlyJobs] >>> Starting task: investor_interest
[InvestorInterest] ========================================
[InvestorInterest] Starting daily interest posting
[InvestorInterest]   Processing investor: John Smith
[InvestorInterest]   → Posted £12.33 interest
...
[InvestorInterest] Summary: 45 processed, 45 succeeded
[InvestorInterest] ========================================
[NightlyJobs] <<< Completed task: investor_interest

[NightlyJobs] ************************************************************
[NightlyJobs] NIGHTLY JOBS COMPLETE
[NightlyJobs] Duration: 1523ms
[NightlyJobs] Summary: 165 processed, 163 succeeded, 2 failed, 0 skipped
[NightlyJobs] ************************************************************
```

---

## 8. ERROR HANDLING

### 8.1 Task-Level Errors

Each task handles errors independently:
- Failed items are logged but don't stop other items
- Summary includes failure counts
- Details array contains error messages

### 8.2 Fatal Errors

Critical errors return HTTP 500:
```json
{
  "error": "Fatal error message"
}
```

### 8.3 Authorization Errors

| Code | Meaning |
|------|---------|
| 401 | Missing or invalid authorization |
| 403 | User is not a super admin |

---

## 9. KEY SOURCE FILES

| File | Purpose |
|------|---------|
| `supabase/functions/nightly-jobs/index.ts` | Main Edge Function |
| `supabase/functions/nightly-jobs/config.toml` | Function config |
| `src/pages/SuperAdmin.jsx` | UI for manual job execution |

---

## 10. ENVIRONMENT VARIABLES

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations |
| `NIGHTLY_JOBS_CRON_SECRET` | Secret for scheduled cron calls |

---

*Last updated: January 2026*
