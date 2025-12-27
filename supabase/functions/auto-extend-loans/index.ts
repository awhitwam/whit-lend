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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LoanScheduleRow {
  id: string
  loan_id: string
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
}

interface Product {
  id: string
  interest_rate: number
  interest_type: string
  period: string
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

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

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
      loans: [] as any[],
      timestamp: new Date().toISOString()
    }

    if (!loans || loans.length === 0) {
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
          .select('due_date')
          .eq('loan_id', loan.id)
          .order('due_date', { ascending: false })
          .limit(1)

        if (scheduleError) {
          throw new Error(`Failed to fetch schedule: ${scheduleError.message}`)
        }

        // Check if schedule already extends beyond today
        if (latestSchedule && latestSchedule.length > 0) {
          const latestDueDate = new Date(latestSchedule[0].due_date)
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

        // Get the product for this loan
        const { data: products, error: productError } = await supabase
          .from('loan_products')
          .select('*')
          .eq('id', loan.product_id)
          .limit(1)

        if (productError || !products || products.length === 0) {
          throw new Error('Product not found')
        }

        const product = products[0] as Product

        // Calculate how many additional periods to add
        const startDate = new Date(loan.start_date)
        const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        const periodsNeeded = product.period === 'Monthly'
          ? Math.ceil(daysSinceStart / 30.44)
          : Math.ceil(daysSinceStart / 7)

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

        // Calculate interest for each new period
        const periodsPerYear = product.period === 'Monthly' ? 12 : 52
        const periodRate = product.interest_rate / 100 / periodsPerYear
        const interestPerPeriod = loan.principal_amount * periodRate

        // Generate new schedule entries
        const newEntries: Partial<LoanScheduleRow>[] = []
        for (let i = 1; i <= periodsToAdd; i++) {
          const periodNumber = currentPeriods + i
          const dueDate = product.period === 'Monthly'
            ? addMonths(startDate, periodNumber)
            : addWeeks(startDate, periodNumber)

          newEntries.push({
            loan_id: loan.id,
            installment_number: periodNumber,
            due_date: dueDate.toISOString().split('T')[0],
            principal_amount: 0,
            interest_amount: Math.round(interestPerPeriod * 100) / 100,
            total_due: Math.round(interestPerPeriod * 100) / 100,
            balance: loan.principal_amount,
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

        // Update loan's total_interest
        const { data: allSchedule } = await supabase
          .from('repayment_schedules')
          .select('interest_amount')
          .eq('loan_id', loan.id)

        const totalInterest = allSchedule?.reduce((sum, row) => sum + row.interest_amount, 0) || 0

        await supabase
          .from('loans')
          .update({
            total_interest: Math.round(totalInterest * 100) / 100,
            total_repayable: Math.round((loan.principal_amount + totalInterest + (loan.exit_fee || 0)) * 100) / 100
          })
          .eq('id', loan.id)

        results.processed++
        results.succeeded++
        results.loans.push({
          loanNumber: loan.loan_number,
          status: 'success',
          periodsAdded: periodsToAdd
        })

        console.log(`[AutoExtend] Successfully extended loan ${loan.loan_number}`)

      } catch (error) {
        console.error(`[AutoExtend] Error processing loan ${loan.loan_number}:`, error)
        results.processed++
        results.failed++
        results.loans.push({
          loanNumber: loan.loan_number,
          status: 'failed',
          error: error.message
        })
      }
    }

    console.log(`[AutoExtend] Run complete: ${results.succeeded} succeeded, ${results.failed} failed, ${results.skipped} skipped`)

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[AutoExtend] Fatal error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Helper functions
function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + weeks * 7)
  return result
}
