-- Add contact_email field to borrowers table
-- This allows grouping multiple borrowers under a common contact person
-- For example, one person (whitwam@gmail.com) may control multiple companies/borrowers

ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- Index for efficient filtering/grouping by contact_email
CREATE INDEX IF NOT EXISTS idx_borrowers_contact_email ON borrowers(contact_email) WHERE contact_email IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN borrowers.contact_email IS 'Email of the primary contact person who manages this borrower. Multiple borrowers can share the same contact_email for grouping purposes.';
