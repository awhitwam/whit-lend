-- Migration: Add period type flags to repayment_schedules
-- These flags help identify roll-up vs serviced periods for display purposes

ALTER TABLE public.repayment_schedules
ADD COLUMN IF NOT EXISTS is_roll_up_period boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS is_serviced_period boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.repayment_schedules.is_roll_up_period IS 'True if this row is part of a roll-up period (interest accruing, not paid)';
COMMENT ON COLUMN public.repayment_schedules.is_serviced_period IS 'True if this row is part of a serviced period (interest paid monthly)';
