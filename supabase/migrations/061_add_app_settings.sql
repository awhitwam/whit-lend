-- Migration: Add app_settings table for system-wide configuration
-- This table stores application-wide settings that can be configured by super admins

-- App-wide settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Insert default session timeout (20 minutes)
INSERT INTO app_settings (key, value, description)
VALUES ('session_timeout_minutes', '20', 'Session inactivity timeout in minutes (5-60)')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read app settings
CREATE POLICY "Authenticated users can read app_settings" ON app_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Only super admins can insert/update/delete app settings
CREATE POLICY "Super admins can manage app_settings" ON app_settings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_super_admin = true
    )
  );

-- Create function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_app_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS app_settings_updated_at ON app_settings;
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_app_settings_updated_at();

-- Add comment
COMMENT ON TABLE app_settings IS 'Application-wide settings configurable by super admins';
