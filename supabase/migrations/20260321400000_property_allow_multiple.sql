-- Add allow_multiple flag to properties (defaults to false for single-select)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS allow_multiple boolean NOT NULL DEFAULT false;
