-- Repair scheduler_type for Roll-Up & Serviced products.
--
-- Migration 058 (058_sync_scheduler_types.sql) had no branch for
-- product_type = 'Roll-Up & Serviced' and no WHERE clause, so it unconditionally
-- rewrote scheduler_type for EVERY product. A roll-up-serviced product therefore
-- fell through to the interest_type branches and became 'interest_only', or hit
-- ELSE 'reducing_balance'.
--
-- The runtime fallback in LoanScheduleManager.jsx does map
-- 'Roll-Up & Serviced' -> 'roll_up_serviced', but only when scheduler_type is
-- NULL. Because 058 left a non-null wrong value, that fallback never fired and
-- the wrong scheduler generated the schedule permanently.
--
-- This migration is scoped by product_type and is safe to re-run.

UPDATE public.loan_products
   SET scheduler_type = 'roll_up_serviced'
 WHERE product_type = 'Roll-Up & Serviced'
   AND (scheduler_type IS DISTINCT FROM 'roll_up_serviced');

-- Backfill any product still missing a scheduler_type so nothing reaches the
-- deprecated legacy generator in LoanScheduleManager.jsx:89-313.
UPDATE public.loan_products
   SET scheduler_type =
     CASE
       WHEN product_type = 'Fixed Charge'        THEN 'fixed_charge'
       WHEN product_type = 'Irregular Income'    THEN 'irregular_income'
       WHEN product_type = 'Rent'                THEN 'rent'
       WHEN product_type = 'Roll-Up & Serviced'  THEN 'roll_up_serviced'
       WHEN interest_type = 'Rolled-Up'          THEN 'rolled_up'
       WHEN interest_type = 'Interest-Only'      THEN 'interest_only'
       WHEN interest_type = 'Flat'               THEN 'flat_rate'
       WHEN interest_type = 'Reducing'           THEN 'reducing_balance'
       ELSE 'reducing_balance'
     END
 WHERE scheduler_type IS NULL;
