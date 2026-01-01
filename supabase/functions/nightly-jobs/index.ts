// Supabase Edge Function: Nightly Jobs
// This function runs scheduled maintenance tasks:
// - Post investor accrued interest on configured posting days
// - Update loan schedule statuses
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

// ============================================================================
// Interest Calculation Functions (mirrored from src/lib/interestCalculation.js)
// ============================================================================

function calculateDailyInterest(balance: number, annualRate: number): number {
  if (!balance || balance <= 0 || !annualRate || annualRate <= 0) {
    return 0
  }
  return (balance * (annualRate / 100)) / 365
}

function daysBetween(startDate: Date | string, endDate: Date | string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = end.getTime() - start.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

function calculateAccruedInterest(balance: number, annualRate: number, lastAccrualDate: string | null) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const lastDate = lastAccrualDate ? new Date(lastAccrualDate) : new Date()
  lastDate.setHours(0, 0, 0, 0)

  const days = daysBetween(lastDate, today)
  const dailyRate = calculateDailyInterest(balance, annualRate)
  const accruedInterest = dailyRate * days

  return {
    accruedInterest: Math.round(accruedInterest * 100) / 100,
    days,
    dailyRate: Math.round(dailyRate * 100) / 100
  }
}

function shouldPostInterestToday(frequency: string, postingDay: number, lastPostingDate: string | null): boolean {
  const today = new Date()
  const currentDay = today.getDate()

  // Check if today is the posting day
  if (currentDay !== postingDay) {
    return false
  }

  // If never posted, should post
  if (!lastPostingDate) {
    return true
  }

  const lastDate = new Date(lastPostingDate)
  const monthsDiff = (today.getFullYear() - lastDate.getFullYear()) * 12 +
    (today.getMonth() - lastDate.getMonth())

  switch (frequency) {
    case 'monthly':
      return monthsDiff >= 1
    case 'quarterly':
      return monthsDiff >= 3
    case 'annually':
      return monthsDiff >= 12
    default:
      return monthsDiff >= 1
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
  const todayStr = today.toISOString().split('T')[0]
  const currentDay = today.getDate()

  console.log(`[InvestorInterest] Starting interest posting check for day ${currentDay}`)

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

  // Filter products where today is the posting day
  const productsToProcess = (products || []).filter((p: InvestorProduct) => p.interest_posting_day === currentDay)

  if (productsToProcess.length === 0) {
    console.log(`[InvestorInterest] No products have posting day ${currentDay}, skipping`)
    result.details.push({ message: `No products with posting day ${currentDay}` })
    return result
  }

  console.log(`[InvestorInterest] ${productsToProcess.length} products have posting day ${currentDay}`)

  // Process each product
  for (const product of productsToProcess as InvestorProduct[]) {
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
        // Check if posting should occur based on frequency and last posting date
        if (!shouldPostInterestToday(product.interest_posting_frequency, product.interest_posting_day, investor.last_accrual_date)) {
          console.log(`[InvestorInterest] Investor ${investor.name}: Already posted this period, skipping`)
          result.skipped++
          result.details.push({
            investor: investor.name,
            product: product.name,
            status: 'skipped',
            reason: 'Already posted this period'
          })
          continue
        }

        // Check minimum balance
        if (investor.current_capital_balance < product.min_balance_for_interest) {
          console.log(`[InvestorInterest] Investor ${investor.name}: Balance ${investor.current_capital_balance} below minimum ${product.min_balance_for_interest}`)
          result.skipped++
          result.details.push({
            investor: investor.name,
            product: product.name,
            status: 'skipped',
            reason: `Balance below minimum (${investor.current_capital_balance} < ${product.min_balance_for_interest})`
          })
          continue
        }

        // Calculate accrued interest
        const { accruedInterest, days } = calculateAccruedInterest(
          investor.current_capital_balance,
          product.interest_rate_per_annum,
          investor.last_accrual_date
        )

        if (accruedInterest <= 0) {
          console.log(`[InvestorInterest] Investor ${investor.name}: No interest to post (${days} days)`)
          result.skipped++
          result.details.push({
            investor: investor.name,
            product: product.name,
            status: 'skipped',
            reason: 'No interest accrued'
          })
          continue
        }

        console.log(`[InvestorInterest] Investor ${investor.name}: Posting ${accruedInterest} interest for ${days} days`)

        // Create interest accrual transaction
        const { error: txError } = await supabase
          .from('InvestorTransaction')
          .insert({
            investor_id: investor.id,
            investor_name: investor.name,
            type: 'interest_accrual',
            amount: accruedInterest,
            date: todayStr,
            description: `Interest accrued: ${days} days at ${product.interest_rate_per_annum}% p.a.`,
            is_auto_generated: true,
            accrual_period_start: investor.last_accrual_date || todayStr,
            accrual_period_end: todayStr
          })

        if (txError) {
          throw new Error(`Failed to create transaction: ${txError.message}`)
        }

        // Update investor record
        const { error: updateError } = await supabase
          .from('Investor')
          .update({
            accrued_interest: 0,
            last_accrual_date: todayStr,
            total_interest_paid: (investor.total_interest_paid || 0) + accruedInterest
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
          amount: accruedInterest,
          days: days
        })

        console.log(`[InvestorInterest] Successfully posted interest for ${investor.name}`)

      } catch (error) {
        console.error(`[InvestorInterest] Error processing investor ${investor.name}:`, error)
        result.failed++
        result.details.push({
          investor: investor.name,
          product: product.name,
          status: 'failed',
          error: error.message
        })
      }
    }
  }

  console.log(`[InvestorInterest] Complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`)
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

  console.log(`[LoanSchedules] Checking for overdue payments as of ${todayStr}`)

  // Fetch all pending schedule entries with due dates in the past
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

  if (scheduleError) {
    console.error('[LoanSchedules] Failed to fetch overdue schedules:', scheduleError)
    result.details.push({ error: `Failed to fetch schedules: ${scheduleError.message}` })
    return result
  }

  console.log(`[LoanSchedules] Found ${overdueSchedules?.length || 0} overdue schedule entries`)

  for (const schedule of (overdueSchedules || []) as any[]) {
    result.processed++

    try {
      const totalPaid = (schedule.principal_paid || 0) + (schedule.interest_paid || 0)
      const isPartiallyPaid = totalPaid > 0 && totalPaid < schedule.total_due

      // Update status to Overdue
      const { error: updateError } = await supabase
        .from('repayment_schedules')
        .update({
          status: isPartiallyPaid ? 'Partial' : 'Overdue'
        })
        .eq('id', schedule.id)

      if (updateError) {
        throw new Error(`Failed to update schedule: ${updateError.message}`)
      }

      result.succeeded++
      result.details.push({
        loan: schedule.loans.loan_number,
        due_date: schedule.due_date,
        status: 'updated',
        new_status: isPartiallyPaid ? 'Partial' : 'Overdue'
      })

    } catch (error) {
      console.error(`[LoanSchedules] Error processing schedule:`, error)
      result.failed++
      result.details.push({
        schedule_id: schedule.id,
        status: 'failed',
        error: error.message
      })
    }
  }

  console.log(`[LoanSchedules] Complete: ${result.succeeded} updated, ${result.failed} failed`)
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

  console.log(`[RecalculateBalances] Starting balance reconciliation`)

  // Fetch all active investors
  const { data: investors, error: investorsError } = await supabase
    .from('Investor')
    .select('id, name, current_capital_balance, total_capital_contributed, total_interest_paid')
    .eq('status', 'Active')

  if (investorsError) {
    console.error('[RecalculateBalances] Failed to fetch investors:', investorsError)
    result.details.push({ error: `Failed to fetch investors: ${investorsError.message}` })
    return result
  }

  for (const investor of (investors || []) as any[]) {
    result.processed++

    try {
      // Fetch all transactions for this investor
      const { data: transactions, error: txError } = await supabase
        .from('InvestorTransaction')
        .select('type, amount')
        .eq('investor_id', investor.id)

      if (txError) {
        throw new Error(`Failed to fetch transactions: ${txError.message}`)
      }

      // Calculate expected values
      const capitalIn = (transactions || [])
        .filter((t: any) => t.type === 'capital_in')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0)

      const capitalOut = (transactions || [])
        .filter((t: any) => t.type === 'capital_out')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0)

      const interestPaid = (transactions || [])
        .filter((t: any) => t.type === 'interest_payment' || t.type === 'interest_accrual')
        .reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0)

      const expectedBalance = capitalIn - capitalOut
      const currentBalance = investor.current_capital_balance || 0

      // Check if recalculation is needed
      const balanceDiff = Math.abs(expectedBalance - currentBalance)
      if (balanceDiff < 0.01) {
        result.skipped++
        continue
      }

      console.log(`[RecalculateBalances] ${investor.name}: Expected ${expectedBalance}, Current ${currentBalance}, Diff ${balanceDiff}`)

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

  console.log(`[RecalculateBalances] Complete: ${result.succeeded} corrected, ${result.skipped} ok, ${result.failed} failed`)
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
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

    console.log(`[NightlyJobs] Starting run at ${new Date().toISOString()}`)
    console.log(`[NightlyJobs] Tasks to run: ${tasksToRun.join(', ')}`)

    const results: TaskResult[] = []

    // Run investor interest posting
    if (tasksToRun.includes('investor_interest')) {
      const interestResult = await processInvestorInterest(supabase)
      results.push(interestResult)
    }

    // Run loan schedule updates
    if (tasksToRun.includes('loan_schedules')) {
      const scheduleResult = await processLoanSchedules(supabase)
      results.push(scheduleResult)
    }

    // Run balance recalculation (optional, can be triggered manually)
    if (tasksToRun.includes('recalculate_balances')) {
      const balanceResult = await recalculateInvestorBalances(supabase)
      results.push(balanceResult)
    }

    const response = {
      timestamp: new Date().toISOString(),
      tasks: results,
      summary: {
        total_processed: results.reduce((sum, r) => sum + r.processed, 0),
        total_succeeded: results.reduce((sum, r) => sum + r.succeeded, 0),
        total_failed: results.reduce((sum, r) => sum + r.failed, 0),
        total_skipped: results.reduce((sum, r) => sum + r.skipped, 0)
      }
    }

    console.log(`[NightlyJobs] Run complete:`, response.summary)

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
