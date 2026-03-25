-- Add archived flag to properties for soft-hiding from entry selection
ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
