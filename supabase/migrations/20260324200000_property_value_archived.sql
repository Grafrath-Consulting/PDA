-- Add archived flag to property_values for soft-hiding from selection
ALTER TABLE property_values ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
