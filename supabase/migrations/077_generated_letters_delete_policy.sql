-- Migration: Add DELETE policy for generated_letters
-- Allows users to delete letter records from their organization

CREATE POLICY "Users can delete letters in their organization"
  ON generated_letters FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );
