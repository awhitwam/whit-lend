-- Add address and contact details to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS postcode TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website TEXT;

-- Add comments for documentation
COMMENT ON COLUMN organizations.address_line1 IS 'Primary address line (street address)';
COMMENT ON COLUMN organizations.address_line2 IS 'Secondary address line (apartment, suite, etc.)';
COMMENT ON COLUMN organizations.city IS 'City or town';
COMMENT ON COLUMN organizations.postcode IS 'Postal/ZIP code';
COMMENT ON COLUMN organizations.country IS 'Country name';
COMMENT ON COLUMN organizations.phone IS 'Contact phone number';
COMMENT ON COLUMN organizations.email IS 'Contact email address';
COMMENT ON COLUMN organizations.website IS 'Organization website URL';
