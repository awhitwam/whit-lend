// Supabase Edge Function: Auto-Extend Loans
// This function automatically extends loan schedules for loans with auto_extend enabled
//
// Deployment:
//   supabase functions deploy auto-extend-loans
//
// Scheduling with pg_cron (run in Supabase SQL Editor):
//   SELECT cron.schedule(
//     'auto-extend-loans-daily',
//     '0 2 * * *',  -- Run at 2 AM daily
//     $$
//     SELECT net.http_post(
//       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/auto-extend-loans',
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
//     'https://YOUR_PROJECT_REF.supabase.co/functions/v1/auto-extend-loans' \
//     --header 'Authorization: Bearer YOUR_ANON_KEY' \
//     --header 'Content-Type: application/json'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  calculatePeriodInterest,
  calculatePrincipalOutstanding,
  roundCurrency
} from '../_shared/interestCalculations.ts'
import {
  advancePeriod,
  differenceInDays,
  formatDateISO,
  getDaysInPeriod,
  normalizeDate
} from '../_shared/dateUtils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LoanScheduleRow {
  id?: string
  loan_id: string
  organization_id?: string
  due_date: string
  installment_number: number
  principal_amount: number
  interest_amount: number
  total_due: number
  balance: number
  principal_paid: number
  interest_paid: number
  status: string
  is_extension_period?: boolean
}

interface Loan {
  id: string
  loan_number: string
  borrower_name: string
  principal_amount: number
  interest_rate: number
  interest_type: string
  period: string
  duration: number
  start_date: string
  auto_extend: boolean
  status: string
  organization_id: string
  product_id: string
  exit_fee?: number
}

interface Product {
  id: string
  interest_rate: number
  interest_type: string
  period: string
  scheduler_type?: string
  scheduler_config?: Record<string, unknown>
}

interface Transaction {
  id: string
  type: string
  amount: number
  gross_amount?: number
  principal_applied?: number
  date: string
  is_deleted?: boolean
}

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

    const today = normalizeDate(new Date())
    const todayStr = formatDateISO(today)

    console.log(`[AutoExtend] Starting auto-extend run for ${todayStr}`)

    // Fetch all loans with auto_extend enabled and status = Live
    const { data: loans, error: loansError } = await supabase
      .from('loans')
      .select('*')
      .eq('auto_extend', true)
      .eq('status', 'Live')
      .eq('is_deleted', false)

    if (loansError) {
      throw new Error(`Failed to fetch loans: ${loansError.message}`)
    }

    console.log(`[AutoExtend] Found ${loans?.length || 0} eligible loans`)

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      loans: [] as Array<{
        loanNumber: string
        status: string
        reason?: string
        periodsAdded?: number
        error?: string
      }>,
      timestamp: new Date().toISOString()
    }

    if (!loans || loans.length === 0) {
      // Log even empty runs for audit trail
      await logJobRun(supabase, todayStr, 'success', results)
      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Process each loan
    for (const loan of loans as Loan[]) {
      try {
        // Get the latest schedule entry for this loan
        const { data: latestSchedule, error: scheduleError } = await supabase
          .from('repayment_schedules')
          .select('due_date, installment_number, balance')
          .eq('loan_id', loan.id)
          .order('due_date', { ascending: false })
          .limit(1)

        if (scheduleError) {
          throw new Error(`Failed to fetch schedule: ${scheduleError.message}`)
        }

        // Check if schedule already extends beyond today
        if (latestSchedule && latestSchedule.length > 0) {
          const latestDueDate = normalizeDate(new Date(latestSchedule[0].due_date))
          if (latestDueDate >= today) {
            console.log(`[AutoExtend] Loan ${loan.loan_number} already extends to ${latestSchedule[0].due_date}, skipping`)
            results.skipped++
            results.loans.push({
              loanNumber: loan.loan_number,
              status: 'skipped',
              reason: `Already extends to ${latestSchedule[0].due_date}`
            })
            continue
          }
        }

        // Get the product for this loan with scheduler config
        const { data: products, error: productError } = await supabase
          .from('loan_products')
          .select('*, scheduler_type, scheduler_config')
          .eq('id', loan.product_id)
          .limit(1)

        if (productError || !products || products.length === 0) {
          throw new Error('Product not found')
        }

        const product = products[0] as Product

        // Fetch transactions to calculate current principal outstanding
        const { data: transactions, error: txError } = await supabase
          .from('transactions')
          .select('*')
          .eq('loan_id', loan.id)
          .eq('is_deleted', false)

        if (txError) {
          throw new Error(`Failed to fetch transactions: ${txError.message}`)
        }

        // Calculate current principal outstanding
        const currentPrincipal = calculatePrincipalOutstanding(
          loan.principal_amount,
          transactions || []
        )

        // If loan is fully repaid, skip
        if (currentPrincipal <= 0) {
          results.skipped++
          results.loans.push({
            loanNumber: loan.loan_number,
            status: 'skipped',
            reason: 'Loan fully repaid'
          })
          continue
        }

        // Determine interest type from product (or loan as fallback)
        const interestType = product.interest_type || loan.interest_type || 'Interest-Only'
        const period = product.period || loan.period || 'Monthly'
        const interestRate = product.interest_rate || loan.interest_rate

        // Calculate how many additional periods to add
        const startDate = normalizeDate(new Date(loan.start_date))
        const daysSinceStart = differenceInDays(today, startDate)
        const daysPerPeriod = getDaysInPeriod(period)
        const periodsNeeded = Math.ceil(daysSinceStart / daysPerPeriod)

        // Get existing schedule count
        const { count: existingCount } = await supabase
          .from('repayment_schedules')
          .select('*', { count: 'exact', head: true })
          .eq('loan_id', loan.id)

        const currentPeriods = existingCount || 0
        const periodsToAdd = Math.max(0, periodsNeeded - currentPeriods + 1) // Add 1 extra for buffer

        if (periodsToAdd <= 0) {
          results.skipped++
          results.loans.push({
            loanNumber: loan.loan_number,
            status: 'skipped',
            reason: 'No additional periods needed'
          })
          continue
        }

        console.log(`[AutoExtend] Loan ${loan.loan_number}: Adding ${periodsToAdd} periods`)
        console.log(`  - Period: ${period}, Interest Type: ${interestType}, Rate: ${interestRate}%`)
        console.log(`  - Current Principal: ${currentPrincipal}, Original: ${loan.principal_amount}`)

        // Generate new schedule entries
        const newEntries: Partial<LoanScheduleRow>[] = []
        for (let i = 1; i <= periodsToAdd; i++) {
          const periodNumber = currentPeriods + i
          const dueDate = advancePeriod(startDate, period, periodNumber)

          // Calculate days in this period for accurate interest
          const prevDueDate = advancePeriod(startDate, period, periodNumber - 1)
          const actualDaysInPeriod = differenceInDays(dueDate, prevDueDate)

          // Calculate interest using proper method based on interest type
          const interestForPeriod = calculatePeriodInterest(
            currentPrincipal,
            interestRate,
            period,
            interestType,
            actualDaysInPeriod
          )

          newEntries.push({
            loan_id: loan.id,
            organization_id: loan.organization_id,
            installment_number: periodNumber,
            due_date: formatDateISO(dueDate),
            principal_amount: 0, // Extension periods typically don't require principal
            interest_amount: roundCurrency(interestForPeriod),
            total_due: roundCurrency(interestForPeriod),
            balance: currentPrincipal, // Current outstanding principal
            principal_paid: 0,
            interest_paid: 0,
            status: 'Pending',
            is_extension_period: true
          })
        }

        // Insert new schedule entries
        const { error: insertError } = await supabase
          .from('repayment_schedules')
          .insert(newEntries)

        if (insertError) {
          throw new Error(`Failed to insert schedule entries: ${insertError.message}`)
        }

        // Update loan's total_interest and total_repayable
        const { data: allSchedule } = await supabase
          .from('repayment_schedules')
          .select('interest_amount')
          .eq('loan_id', loan.id)

        const totalInterest = allSchedule?.reduce((sum, row) => sum + (row.interest_amount || 0), 0) || 0

        await supabase
          .from('loans')
          .update({
            total_interest: roundCurrency(totalInterest),
            total_repayable: roundCurrency(loan.principal_amount + totalInterest + (loan.exit_fee || 0))
          })
          .eq('id', loan.id)

        results.processed++
        results.succeeded++
        results.loans.push({
          loanNumber: loan.loan_number,
          status: 'success',
          periodsAdded: periodsToAdd
        })

        console.log(`[AutoExtend] Successfully extended loan ${loan.loan_number} with ${periodsToAdd} periods`)

      } catch (error) {
        console.error(`[AutoExtend] Error processing loan ${loan.loan_number}:`, error)
        results.processed++
        results.failed++
        results.loans.push({
          loanNumber: loan.loan_number,
          status: 'failed',
          error: (error as Error).message
        })
      }
    }

    console.log(`[AutoExtend] Run complete: ${results.succeeded} succeeded, ${results.failed} failed, ${results.skipped} skipped`)

    // Log job run to audit table
    const status = results.failed > 0 ? (results.succeeded > 0 ? 'partial' : 'failed') : 'success'
    await logJobRun(supabase, todayStr, status, results)

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[AutoExtend] Fatal error:', error)
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

/**
 * Log job run to nightly_job_runs table for audit trail
 */
async function logJobRun(
  supabase: ReturnType<typeof createClient>,
  runDate: string,
  status: string,
  results: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('nightly_job_runs').insert({
      job_name: 'auto-extend-loans',
      run_date: runDate,
      status,
      summary: JSON.stringify(results),
      organization_id: null, // System-wide job, not org-specific
      created_at: new Date().toISOString()
    })
  } catch (err) {
    // Don't fail the job if logging fails
    console.error('[AutoExtend] Failed to log job run:', err)
  }
}
