// Supabase Edge Function: Nightly Jobs
// This function runs scheduled maintenance tasks:
// - Post investor interest monthly (calculates day-by-day based on balance changes)
// - Update loan schedule statuses (mark overdue/partial)
// - Recalculate investor balances if needed
//
// Deployment:
//   supabase functions deploy nightly-jobs
//
// Scheduling with pg_cron (run in Supabase SQL Editor):
//   SELECT cron.schedule(
//     'nightly-jobs',
//     '0 2 * * *',  -- Run at 2 AM daily
//     $$
//     SELECT net.http_post(
//       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/nightly-jobs',
//       headers := jsonb_build_object(
//         'Authorization', 'Bearer YOUR_ANON_KEY',
//         'Content-Type', 'application/json'
//       ),
//       body := '{}'::jsonb
//     ) AS request_id;
//     $$
//   );
//
// Manual invocation:
//   curl -i --location --request POST \
//     'https://YOUR_PROJECT_REF.supabase.co/functions/v1/nightly-jobs' \
//     --header 'Authorization: Bearer YOUR_ANON_KEY' \
//     --header 'Content-Type: application/json' \
//     --data '{"tasks": ["investor_interest", "loan_schedules"]}'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// Types
// ============================================================================

interface Investor {
  id: string
  name: string
  organization_id: string
  current_capital_balance: number
  accrued_interest: number
  last_accrual_date: string | null
  total_interest_paid: number
  investor_product_id: string | null
  status: string
}

interface InvestorProduct {
  id: string
  name: string
  interest_rate_per_annum: number
  interest_calculation_type: string
  interest_posting_frequency: string
  interest_posting_day: number
  min_balance_for_interest: number
}

interface Loan {
  id: string
  loan_number: string
  status: string
  organization_id: string
}

interface RepaymentSchedule {
  id: string
  loan_id: string
  due_date: string
  status: string
  total_due: number
  principal_paid: number
  interest_paid: number
}

interface TaskResult {
  task: string
  processed: number
  succeeded: number
  failed: number
  skipped: number
  details: any[]
}

interface InterestSegment {
  days: number
  balance: number
  dailyRate: number
  interest: number
}

interface InvestorTransaction {
  type: string
  amount: string | number
  date: string
}


// ============================================================================
// Day-by-Day Interest Calculation for Investors
// ============================================================================

async function calculateInvestorInterestForMonth(
  supabase: any,
  investor: Investor,
  annualRate: number,
  periodStart: Date,
  periodEnd: Date
): Promise<{ totalInterest: number; segments: InterestSegment[]; description: string }> {

  // Fetch all capital transactions for this investor
  const { data: transactions, error: txError } = await supabase
    .from('InvestorTransaction')
    .select('type, amount, date')
    .eq('investor_id', investor.id)
    .order('date', { ascending: true })

  if (txError) {
    console.error(`[InvestorInterest] Failed to fetch transactions for ${investor.name}:`, txError)
    return { totalInterest: 0, segments: [], description: 'Error fetching transactions' }
  }

  const txList = (transactions || []) as InvestorTransaction[]

  // Calculate balance at start of period (sum of all transactions before period start)
  let balanceAtPeriodStart = 0
  for (const tx of txList) {
    const txDate = new Date(tx.date)
    txDate.setHours(0, 0, 0, 0)
    if (txDate < periodStart) {
      const amount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount
      balanceAtPeriodStart += tx.type === 'capital_in' ? amount : -amount
    }
  }

  // Get all balance change events within the period
  interface ChangeEvent {
    date: Date
    newBalance: number
  }
  const changeEvents: ChangeEvent[] = []
  let currentBalance = balanceAtPeriodStart

  for (const tx of txList) {
    const txDate = new Date(tx.date)
    txDate.setHours(0, 0, 0, 0)
    if (txDate >= periodStart && txDate <= periodEnd) {
      const amount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount
      currentBalance += tx.type === 'capital_in' ? amount : -amount
      changeEvents.push({ date: txDate, newBalance: currentBalance })
    }
  }

  // Calculate interest segment by segment
  const segments: InterestSegment[] = []
  let totalInterest = 0
  let segmentStart = new Date(periodStart)
  let segmentBalance = balanceAtPeriodStart
  const dailyRateFactor = annualRate / 100 / 365

  for (const event of changeEvents) {
    // Calculate days from segment start to day before the change
    const daysInSegment = Math.floor((event.date.getTime() - segmentStart.getTime()) / (1000 * 60 * 60 * 24))

    if (daysInSegment > 0 && segmentBalance > 0) {
      const dailyRate = segmentBalance * dailyRateFactor
      const segmentInterest = dailyRate * daysInSegment
      segments.push({
        days: daysInSegment,
        balance: Math.round(segmentBalance * 100) / 100,
        dailyRate: Math.round(dailyRate * 100) / 100,
        interest: Math.round(segmentInterest * 100) / 100
      })
      totalInterest += segmentInterest
    }

    segmentStart = new Date(event.date)
    segmentBalance = event.newBalance
  }

  // Final segment: from last change (or period start) to end of period (inclusive)
  const finalDays = Math.floor((periodEnd.getTime() - segmentStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  if (finalDays > 0 && segmentBalance > 0) {
    const dailyRate = segmentBalance * dailyRateFactor
    const segmentInterest = dailyRate * finalDays
    segments.push({
      days: finalDays,
      balance: Math.round(segmentBalance * 100) / 100,
      dailyRate: Math.round(dailyRate * 100) / 100,
      interest: Math.round(segmentInterest * 100) / 100
    })
    totalInterest += segmentInterest
  }

  // Build description with working
  // Format: "Interest for December 2025: 9d @ £1.37 + 15d @ £2.05 = £55.54"
  const monthName = periodStart.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  const roundedTotal = Math.round(totalInterest * 100) / 100

  let description: string
  if (segments.length === 0) {
    description = `Interest for ${monthName}: No balance`
  } else if (segments.length === 1) {
    const s = segments[0]
    description = `Interest for ${monthName}: ${s.days}d @ £${s.dailyRate.toFixed(2)} = £${roundedTotal.toFixed(2)}`
  } else {
    const workingParts = segments.map(s => `${s.days}d @ £${s.dailyRate.toFixed(2)}`)
    description = `Interest for ${monthName}: ${workingParts.join(' + ')} = £${roundedTotal.toFixed(2)}`
  }

  return {
    totalInterest: roundedTotal,
    segments,
    description
  }
}

// ============================================================================
// Task: Post Investor Interest
// ============================================================================

async function processInvestorInterest(supabase: any): Promise<TaskResult> {
  const result: TaskResult = {
    task: 'investor_interest',
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    details: []
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Calculate previous month dates
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0) // Last day of prev month
  prevMonthEnd.setHours(0, 0, 0, 0)
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1) // 1st of prev month
  prevMonthStart.setHours(0, 0, 0, 0)

  const prevMonthEndStr = prevMonthEnd.toISOString().split('T')[0]
  const prevMonthStartStr = prevMonthStart.toISOString().split('T')[0]
  const monthName = prevMonthStart.toLocaleString('en-GB', { month: 'long', year: 'numeric' })

  console.log(`[InvestorInterest] ========================================`)
  console.log(`[InvestorInterest] Starting monthly interest posting`)
  console.log(`[InvestorInterest] Today: ${today.toISOString().split('T')[0]}`)
  console.log(`[InvestorInterest] Posting interest for: ${monthName}`)
  console.log(`[InvestorInterest] Period: ${prevMonthStartStr} to ${prevMonthEndStr}`)
  console.log(`[InvestorInterest] ========================================`)

  // Fetch all investor products with automatic interest calculation
  const { data: products, error: productsError } = await supabase
    .from('investor_products')
    .select('*')
    .eq('interest_calculation_type', 'automatic')
    .eq('status', 'Active')

  if (productsError) {
    console.error('[InvestorInterest] Failed to fetch products:', productsError)
    result.details.push({ error: `Failed to fetch products: ${productsError.message}` })
    return result
  }

  console.log(`[InvestorInterest] Found ${products?.length || 0} automatic interest products`)
  for (const p of (products || []) as InvestorProduct[]) {
    console.log(`[InvestorInterest]   - "${p.name}": ${p.interest_rate_per_annum}% p.a.`)
  }

  // Process each product (no longer filtering by posting day)
  for (const product of (products || []) as InvestorProduct[]) {
    // Fetch all active investors with this product
    const { data: investors, error: investorsError } = await supabase
      .from('Investor')
      .select('*')
      .eq('investor_product_id', product.id)
      .eq('status', 'Active')

    if (investorsError) {
      console.error(`[InvestorInterest] Failed to fetch investors for product ${product.name}:`, investorsError)
      result.details.push({ product: product.name, error: investorsError.message })
      continue
    }

    console.log(`[InvestorInterest] Product "${product.name}": ${investors?.length || 0} active investors`)

    for (const investor of (investors || []) as Investor[]) {
      result.processed++

      try {
        // Check if interest already posted for previous month (idempotent check)
        const { data: existingCredit, error: checkError } = await supabase
          .from('investor_interest')
          .select('id')
          .eq('investor_id', investor.id)
          .eq('type', 'credit')
          .gte('date', prevMonthStartStr)
          .lte('date', prevMonthEndStr)
          .limit(1)

        if (checkError) {
          throw new Error(`Failed to check existing credits: ${checkError.message}`)
        }

        if (existingCredit && existingCredit.length > 0) {
          console.log(`[InvestorInterest] Investor ${investor.name}: Already posted for ${monthName}, skipping`)
          result.skipped++
          result.details.push({
            investor: investor.name,
            product: product.name,
            status: 'skipped',
            reason: `Already posted for ${monthName}`
          })
          continue
        }

        // Calculate interest day-by-day for the previous month
        const { totalInterest, segments, description } = await calculateInvestorInterestForMonth(
          supabase,
          investor,
          product.interest_rate_per_annum,
          prevMonthStart,
          prevMonthEnd
        )

        if (totalInterest <= 0) {
          console.log(`[InvestorInterest] Investor ${investor.name}: No interest to post (zero balance)`)
          result.skipped++
          result.details.push({
            investor: investor.name,
            product: product.name,
            status: 'skipped',
            reason: 'No balance during period'
          })
          continue
        }

        console.log(`[InvestorInterest] Investor ${investor.name}: Posting £${totalInterest.toFixed(2)} interest`)
        console.log(`[InvestorInterest]   ${description}`)

        // Create interest credit entry dated as last day of the month
        const { error: txError } = await supabase
          .from('investor_interest')
          .insert({
            organization_id: investor.organization_id,
            investor_id: investor.id,
            date: prevMonthEndStr,
            type: 'credit',
            amount: totalInterest,
            description: description
          })

        if (txError) {
          throw new Error(`Failed to create interest entry: ${txError.message}`)
        }

        // Update investor record with last accrual date
        const { error: updateError } = await supabase
          .from('Investor')
          .update({
            last_accrual_date: prevMonthEndStr,
            total_interest_paid: (investor.total_interest_paid || 0) + totalInterest
          })
          .eq('id', investor.id)

        if (updateError) {
          throw new Error(`Failed to update investor: ${updateError.message}`)
        }

        result.succeeded++
        result.details.push({
          investor: investor.name,
          product: product.name,
          status: 'success',
          amount: totalInterest,
          segments: segments.length,
          description: description
        })

        console.log(`[InvestorInterest] Successfully posted interest for ${investor.name}`)

      } catch (error) {
        console.error(`[InvestorInterest] Error processing investor ${investor.name}:`, error)
        result.failed++
        result.details.push({
          investor: investor.name,
          product: product.name,
          status: 'failed',
          error: (error as Error).message
        })
      }
    }
  }

  console.log(`[InvestorInterest] ========================================`)
  console.log(`[InvestorInterest] Complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`)
  console.log(`[InvestorInterest] ========================================`)
  return result
}

// ============================================================================
// Task: Update Loan Schedule Statuses
// ============================================================================

async function processLoanSchedules(supabase: any): Promise<TaskResult> {
  const result: TaskResult = {
    task: 'loan_schedules',
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    details: []
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split('T')[0]

  console.log(`[LoanSchedules] ========================================`)
  console.log(`[LoanSchedules] Starting schedule status updates`)
  console.log(`[LoanSchedules] Date: ${todayStr}`)
  console.log(`[LoanSchedules] ========================================`)

  // Fetch all pending schedule entries with due dates in the past
  // Use .limit(10000) to override Supabase default of 1000
  const { data: overdueSchedules, error: scheduleError } = await supabase
    .from('repayment_schedules')
    .select(`
      id,
      loan_id,
      due_date,
      status,
      total_due,
      principal_paid,
      interest_paid,
      installment_number,
      loans!inner(
        id,
        loan_number,
        status,
        organization_id
      )
    `)
    .eq('status', 'Pending')
    .lt('due_date', todayStr)
    .eq('loans.status', 'Live')
    .limit(10000)

  if (scheduleError) {
    console.error('[LoanSchedules] Failed to fetch overdue schedules:', scheduleError)
    result.details.push({ error: `Failed to fetch schedules: ${scheduleError.message}` })
    return result
  }

  const scheduleCount = overdueSchedules?.length || 0

  // Group by loan to show meaningful summary
  const byLoan = new Map<string, { loan_number: string, entries: any[] }>()
  for (const schedule of (overdueSchedules || []) as any[]) {
    const loanId = schedule.loan_id
    if (!byLoan.has(loanId)) {
      byLoan.set(loanId, {
        loan_number: schedule.loans.loan_number,
        entries: []
      })
    }
    byLoan.get(loanId)!.entries.push(schedule)
  }

  const uniqueLoanCount = byLoan.size
  console.log(`[LoanSchedules] Found ${scheduleCount} overdue schedule entries across ${uniqueLoanCount} loans`)

  // Log breakdown by loan
  for (const [loanId, data] of byLoan) {
    console.log(`[LoanSchedules]   Loan #${data.loan_number}: ${data.entries.length} overdue entries`)
  }

  // Track updates per loan for summary
  const loanUpdates = new Map<string, { loan_number: string, updated: number, toOverdue: number, toPartial: number }>()

  for (const schedule of (overdueSchedules || []) as any[]) {
    result.processed++

    try {
      const totalPaid = (schedule.principal_paid || 0) + (schedule.interest_paid || 0)
      const isPartiallyPaid = totalPaid > 0 && totalPaid < schedule.total_due
      const newStatus = isPartiallyPaid ? 'Partial' : 'Overdue'

      // Update status
      const { error: updateError } = await supabase
        .from('repayment_schedules')
        .update({ status: newStatus })
        .eq('id', schedule.id)

      if (updateError) {
        throw new Error(`Failed to update schedule: ${updateError.message}`)
      }

      result.succeeded++

      // Track per-loan summary
      const loanId = schedule.loan_id
      if (!loanUpdates.has(loanId)) {
        loanUpdates.set(loanId, {
          loan_number: schedule.loans.loan_number,
          updated: 0,
          toOverdue: 0,
          toPartial: 0
        })
      }
      const loanStats = loanUpdates.get(loanId)!
      loanStats.updated++
      if (newStatus === 'Overdue') loanStats.toOverdue++
      if (newStatus === 'Partial') loanStats.toPartial++

    } catch (error) {
      console.error(`[LoanSchedules] Error processing schedule for loan #${schedule.loans.loan_number}:`, error)
      result.failed++
      result.details.push({
        loan: schedule.loans.loan_number,
        schedule_id: schedule.id,
        installment: schedule.installment_number,
        status: 'failed',
        error: error.message
      })
    }
  }

  // Build summary details (per loan, not per entry)
  for (const [loanId, stats] of loanUpdates) {
    result.details.push({
      loan: stats.loan_number,
      entries_updated: stats.updated,
      to_overdue: stats.toOverdue,
      to_partial: stats.toPartial
    })
  }

  console.log(`[LoanSchedules] ========================================`)
  console.log(`[LoanSchedules] Summary:`)
  console.log(`[LoanSchedules]   - Total entries updated: ${result.succeeded}`)
  console.log(`[LoanSchedules]   - Loans affected: ${loanUpdates.size}`)
  console.log(`[LoanSchedules]   - Failed: ${result.failed}`)

  // Log per-loan summary
  for (const [loanId, stats] of loanUpdates) {
    console.log(`[LoanSchedules]   - Loan #${stats.loan_number}: ${stats.updated} updated (${stats.toOverdue} overdue, ${stats.toPartial} partial)`)
  }
  console.log(`[LoanSchedules] ========================================`)

  return result
}

// ============================================================================
// Task: Recalculate Investor Balances
// ============================================================================

async function recalculateInvestorBalances(supabase: any): Promise<TaskResult> {
  const result: TaskResult = {
    task: 'recalculate_balances',
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    details: []
  }

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  console.log(`[RecalculateBalances] ========================================`)
  console.log(`[RecalculateBalances] Starting balance reconciliation`)
  console.log(`[RecalculateBalances] Date: ${todayStr}`)
  console.log(`[RecalculateBalances] ========================================`)

  // Fetch all active investors
  const { data: investors, error: investorsError } = await supabase
    .from('Investor')
    .select('id, name, current_capital_balance, total_capital_contributed, total_interest_paid, organization_id')
    .eq('status', 'Active')

  if (investorsError) {
    console.error('[RecalculateBalances] Failed to fetch investors:', investorsError)
    result.details.push({ error: `Failed to fetch investors: ${investorsError.message}` })
    return result
  }

  const investorCount = investors?.length || 0
  console.log(`[RecalculateBalances] Found ${investorCount} active investors to check`)

  for (const investor of (investors || []) as any[]) {
    result.processed++

    try {
      // Fetch all capital transactions for this investor
      const { data: transactions, error: txError } = await supabase
        .from('InvestorTransaction')
        .select('type, amount')
        .eq('investor_id', investor.id)

      if (txError) {
        throw new Error(`Failed to fetch transactions: ${txError.message}`)
      }

      // Fetch interest entries from the investor_interest ledger
      const { data: interestEntries, error: interestError } = await supabase
        .from('investor_interest')
        .select('type, amount')
        .eq('investor_id', investor.id)

      if (interestError) {
        throw new Error(`Failed to fetch interest entries: ${interestError.message}`)
      }

      // Calculate expected values
      const capitalIn = (transactions || [])
        .filter((t: any) => t.type === 'capital_in')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0)

      const capitalOut = (transactions || [])
        .filter((t: any) => t.type === 'capital_out')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0)

      // Calculate interest from the new ledger: credits - debits
      const interestCredits = (interestEntries || [])
        .filter((e: any) => e.type === 'credit')
        .reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0)

      const interestDebits = (interestEntries || [])
        .filter((e: any) => e.type === 'debit')
        .reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0)

      const interestPaid = interestCredits

      const expectedBalance = capitalIn - capitalOut
      const currentBalance = investor.current_capital_balance || 0

      // Check if recalculation is needed
      const balanceDiff = Math.abs(expectedBalance - currentBalance)
      if (balanceDiff < 0.01) {
        console.log(`[RecalculateBalances]   ${investor.name}: Balance OK (${currentBalance})`)
        result.skipped++
        continue
      }

      console.log(`[RecalculateBalances]   ${investor.name}: MISMATCH DETECTED`)
      console.log(`[RecalculateBalances]     - Current balance: ${currentBalance}`)
      console.log(`[RecalculateBalances]     - Expected balance: ${expectedBalance}`)
      console.log(`[RecalculateBalances]     - Difference: ${balanceDiff}`)
      console.log(`[RecalculateBalances]     - Capital in: ${capitalIn}, Capital out: ${capitalOut}`)
      console.log(`[RecalculateBalances]     - Interest credits: ${interestCredits}, Interest debits: ${interestDebits}`)

      // Update investor with corrected values
      const { error: updateError } = await supabase
        .from('Investor')
        .update({
          current_capital_balance: Math.round(expectedBalance * 100) / 100,
          total_capital_contributed: Math.round(capitalIn * 100) / 100,
          total_interest_paid: Math.round(interestPaid * 100) / 100
        })
        .eq('id', investor.id)

      if (updateError) {
        throw new Error(`Failed to update investor: ${updateError.message}`)
      }

      console.log(`[RecalculateBalances]     - CORRECTED: ${currentBalance} → ${expectedBalance}`)

      result.succeeded++
      result.details.push({
        investor: investor.name,
        status: 'corrected',
        previous_balance: currentBalance,
        new_balance: expectedBalance,
        difference: balanceDiff
      })

    } catch (error) {
      console.error(`[RecalculateBalances] Error processing investor ${investor.name}:`, error)
      result.failed++
      result.details.push({
        investor: investor.name,
        status: 'failed',
        error: error.message
      })
    }
  }

  console.log(`[RecalculateBalances] ========================================`)
  console.log(`[RecalculateBalances] Summary:`)
  console.log(`[RecalculateBalances]   - Total checked: ${result.processed}`)
  console.log(`[RecalculateBalances]   - Balances OK: ${result.skipped}`)
  console.log(`[RecalculateBalances]   - Corrected: ${result.succeeded}`)
  console.log(`[RecalculateBalances]   - Failed: ${result.failed}`)
  console.log(`[RecalculateBalances] ========================================`)
  return result
}

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ========== AUTHORIZATION ==========
    // Check for cron secret first (for scheduled runs via pg_cron)
    const cronSecret = req.headers.get('x-cron-secret')
    const expectedCronSecret = Deno.env.get('NIGHTLY_JOBS_CRON_SECRET')

    let authorizedBy = ''

    if (cronSecret && expectedCronSecret && cronSecret === expectedCronSecret) {
      // Authorized via cron secret
      authorizedBy = 'cron'
      console.log('[NightlyJobs] Authorized via cron secret')
    } else {
      // Fall back to user JWT auth (for UI calls)
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) {
        console.log('[NightlyJobs] Missing authorization header')
        return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const token = authHeader.replace('Bearer ', '')

      // Verify token and get user
      const { data: { user }, error: userError } = await supabase.auth.getUser(token)

      if (userError || !user) {
        console.log('[NightlyJobs] Invalid token:', userError?.message)
        return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Check super admin status
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('is_super_admin')
        .eq('id', user.id)
        .single()

      if (profileError || !profile?.is_super_admin) {
        console.log('[NightlyJobs] Access denied for user:', user.email)
        return new Response(JSON.stringify({ error: 'Super admin access required' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      authorizedBy = `super_admin:${user.email}`
      console.log('[NightlyJobs] Authorized super admin:', user.email)
    }
    // ========== END AUTHORIZATION ==========

    // Parse request body for specific tasks (optional)
    let tasksToRun = ['investor_interest', 'loan_schedules']

    try {
      const body = await req.json()
      if (body.tasks && Array.isArray(body.tasks)) {
        tasksToRun = body.tasks
      }
    } catch {
      // No body or invalid JSON, use defaults
    }

    const startTime = new Date()
    console.log(``)
    console.log(`[NightlyJobs] ************************************************************`)
    console.log(`[NightlyJobs] NIGHTLY JOBS STARTING`)
    console.log(`[NightlyJobs] Timestamp: ${startTime.toISOString()}`)
    console.log(`[NightlyJobs] Tasks requested: ${tasksToRun.join(', ')}`)
    console.log(`[NightlyJobs] ************************************************************`)
    console.log(``)

    const results: TaskResult[] = []

    // Run investor interest posting
    if (tasksToRun.includes('investor_interest')) {
      console.log(`[NightlyJobs] >>> Starting task: investor_interest`)
      const interestResult = await processInvestorInterest(supabase)
      results.push(interestResult)
      console.log(`[NightlyJobs] <<< Completed task: investor_interest`)
      console.log(``)
    }

    // Run loan schedule updates
    if (tasksToRun.includes('loan_schedules')) {
      console.log(`[NightlyJobs] >>> Starting task: loan_schedules`)
      const scheduleResult = await processLoanSchedules(supabase)
      results.push(scheduleResult)
      console.log(`[NightlyJobs] <<< Completed task: loan_schedules`)
      console.log(``)
    }

    // Run balance recalculation (optional, can be triggered manually)
    if (tasksToRun.includes('recalculate_balances')) {
      console.log(`[NightlyJobs] >>> Starting task: recalculate_balances`)
      const balanceResult = await recalculateInvestorBalances(supabase)
      results.push(balanceResult)
      console.log(`[NightlyJobs] <<< Completed task: recalculate_balances`)
      console.log(``)
    }

    const endTime = new Date()
    const durationMs = endTime.getTime() - startTime.getTime()

    const response = {
      timestamp: endTime.toISOString(),
      duration_ms: durationMs,
      tasks: results,
      summary: {
        total_processed: results.reduce((sum, r) => sum + r.processed, 0),
        total_succeeded: results.reduce((sum, r) => sum + r.succeeded, 0),
        total_failed: results.reduce((sum, r) => sum + r.failed, 0),
        total_skipped: results.reduce((sum, r) => sum + r.skipped, 0)
      }
    }

    console.log(`[NightlyJobs] ************************************************************`)
    console.log(`[NightlyJobs] NIGHTLY JOBS COMPLETE`)
    console.log(`[NightlyJobs] Duration: ${durationMs}ms`)
    console.log(`[NightlyJobs] Summary: ${response.summary.total_processed} processed, ${response.summary.total_succeeded} succeeded, ${response.summary.total_failed} failed, ${response.summary.total_skipped} skipped`)
    console.log(`[NightlyJobs] ************************************************************`)

    // Log each task result to the audit table
    for (const taskResult of results) {
      try {
        const status = taskResult.failed > 0
          ? (taskResult.succeeded > 0 ? 'partial' : 'failed')
          : 'success'

        await supabase
          .from('nightly_job_runs')
          .insert({
            task_name: taskResult.task,
            status: status,
            processed: taskResult.processed,
            succeeded: taskResult.succeeded,
            failed: taskResult.failed,
            skipped: taskResult.skipped,
            details: taskResult.details
          })
      } catch (logError) {
        console.error(`[NightlyJobs] Failed to log task result:`, logError)
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[NightlyJobs] Fatal error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
