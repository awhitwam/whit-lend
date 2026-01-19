-- Migration: Add email body template to letter_templates
-- Allows configuring default email body text when sending letters via email

-- Add email body template field to letter_templates
ALTER TABLE letter_templates
ADD COLUMN IF NOT EXISTS email_body_template TEXT;

-- Add comment for documentation
COMMENT ON COLUMN letter_templates.email_body_template IS 'Default email body text when sending this letter via email. Supports same placeholders as body_template.';
