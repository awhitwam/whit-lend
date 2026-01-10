-- =====================================================
-- DELETE OTHER_INCOME SINCE 01/04/2025 (ALL ORGANIZATIONS)
-- =====================================================
-- WARNING: This is a DESTRUCTIVE operation!
-- Run this in the Supabase SQL Editor after reviewing.
-- =====================================================

-- Step 0: Preview what will be deleted (RUN THIS FIRST!)
/*
SELECT
  oi.id,
  oi.organization_id,
  oi.date,
  oi.amount,
  oi.description,
  re.id as reconciliation_entry_id,
  re.bank_statement_id
FROM other_income oi
LEFT JOIN reconciliation_entries re ON re.other_income_id = oi.id
WHERE oi.date >= '2025-04-01'
ORDER BY oi.organization_id, oi.date;
*/

-- Count summary
/*
SELECT COUNT(*) as count, SUM(amount) as total
FROM other_income
WHERE date >= '2025-04-01';
*/

-- =====================================================
-- STEP 1: Delete ReconciliationEntries first (FK dependency)
-- =====================================================

DELETE FROM reconciliation_entries
WHERE other_income_id IN (
  SELECT id FROM other_income WHERE date >= '2025-04-01'
);

-- =====================================================
-- STEP 2: Delete AcceptedOrphans that reference these entries
-- =====================================================

DELETE FROM accepted_orphans
WHERE entity_type = 'other_income'
AND entity_id IN (
  SELECT id FROM other_income WHERE date >= '2025-04-01'
);

-- =====================================================
-- STEP 3: Delete the other_income entries
-- =====================================================

DELETE FROM other_income
WHERE date >= '2025-04-01';

-- =====================================================
-- STEP 4: Verify deletion
-- =====================================================

SELECT COUNT(*) as remaining_other_income_since_april_2025
FROM other_income
WHERE date >= '2025-04-01';
