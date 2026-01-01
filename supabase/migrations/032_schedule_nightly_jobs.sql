-- =====================================================
-- Schedule Nightly Jobs with pg_cron
-- =====================================================
-- This migration sets up automated nightly job scheduling.
--
-- Prerequisites:
-- 1. pg_cron and pg_net extensions must be enabled in Supabase dashboard
-- 2. Edge function 'nightly-jobs' must be deployed
-- 3. Replace YOUR_PROJECT_REF and YOUR_ANON_KEY with actual values
--
-- To enable extensions, go to Supabase Dashboard > Database > Extensions
-- and enable: pg_cron, pg_net

-- Note: This is a template. Run these commands manually in the SQL Editor
-- after deploying the Edge function and replacing placeholders.

/*
-- Enable required extensions (if not already enabled via dashboard)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule nightly jobs to run at 2 AM UTC daily
SELECT cron.schedule(
  'nightly-jobs-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/nightly-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_ANON_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{"tasks": ["investor_interest", "loan_schedules"]}'::jsonb
  ) AS request_id;
  $$
);

-- Optional: Schedule balance recalculation weekly (Sundays at 3 AM)
SELECT cron.schedule(
  'recalculate-balances-weekly',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/nightly-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_ANON_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{"tasks": ["recalculate_balances"]}'::jsonb
  ) AS request_id;
  $$
);

-- To view scheduled jobs:
-- SELECT * FROM cron.job;

-- To unschedule a job:
-- SELECT cron.unschedule('nightly-jobs-daily');
-- SELECT cron.unschedule('recalculate-balances-weekly');

-- To view job run history:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
*/

-- Create a table to track nightly job runs (for UI display)
CREATE TABLE IF NOT EXISTS public.nightly_job_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  run_date timestamp with time zone DEFAULT now(),
  task_name text NOT NULL,
  status text NOT NULL, -- 'success', 'partial', 'failed'
  processed integer DEFAULT 0,
  succeeded integer DEFAULT 0,
  failed integer DEFAULT 0,
  skipped integer DEFAULT 0,
  details jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT nightly_job_runs_pkey PRIMARY KEY (id)
);

-- Create index for querying recent runs
CREATE INDEX IF NOT EXISTS idx_nightly_job_runs_date ON public.nightly_job_runs(run_date DESC);
CREATE INDEX IF NOT EXISTS idx_nightly_job_runs_org ON public.nightly_job_runs(organization_id);

-- Enable RLS
ALTER TABLE public.nightly_job_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies - allow viewing job runs for user's organizations
DROP POLICY IF EXISTS "nightly_job_runs_select" ON nightly_job_runs;
CREATE POLICY "nightly_job_runs_select" ON nightly_job_runs
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()) OR organization_id IS NULL);

-- Service role can insert (for Edge functions)
DROP POLICY IF EXISTS "nightly_job_runs_insert" ON nightly_job_runs;
CREATE POLICY "nightly_job_runs_insert" ON nightly_job_runs
  FOR INSERT WITH CHECK (true);

COMMENT ON TABLE public.nightly_job_runs IS 'Tracks nightly automated job executions for auditing';
