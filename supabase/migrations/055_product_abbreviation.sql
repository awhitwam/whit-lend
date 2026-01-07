-- Add abbreviation column to loan_products table
ALTER TABLE loan_products
ADD COLUMN IF NOT EXISTS abbreviation VARCHAR(10);

-- Add comment explaining the column
COMMENT ON COLUMN loan_products.abbreviation IS 'Short code for product displayed on loans list (max 10 chars, e.g. BRG, DEV)';
