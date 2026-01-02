-- Migration: Add trusted_devices table for MFA browser trust
-- This allows users to skip 2FA verification on trusted browsers for 7 days

CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL UNIQUE,
  device_name TEXT,
  user_agent TEXT,
  trusted_until TIMESTAMPTZ NOT NULL,
  last_used TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_token ON trusted_devices(device_token);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_expiry ON trusted_devices(trusted_until);

-- Enable RLS
ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own trusted devices
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own devices' AND tablename = 'trusted_devices') THEN
    CREATE POLICY "Users can view own devices" ON trusted_devices
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own devices' AND tablename = 'trusted_devices') THEN
    CREATE POLICY "Users can insert own devices" ON trusted_devices
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own devices' AND tablename = 'trusted_devices') THEN
    CREATE POLICY "Users can update own devices" ON trusted_devices
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own devices' AND tablename = 'trusted_devices') THEN
    CREATE POLICY "Users can delete own devices" ON trusted_devices
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON TABLE trusted_devices IS 'Stores trusted browser tokens for MFA bypass. Tokens expire after 7 days.';
COMMENT ON COLUMN trusted_devices.device_token IS 'Cryptographically random token stored in browser localStorage';
COMMENT ON COLUMN trusted_devices.trusted_until IS 'Expiration date after which MFA is required again';
