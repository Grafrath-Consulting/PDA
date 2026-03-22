-- Add completed_at column
ALTER TABLE public.journal_blocks
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;

-- Trigger to auto-stamp completed_at on status transitions
CREATE OR REPLACE FUNCTION set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'complete' AND (OLD.status IS NULL OR OLD.status <> 'complete') THEN
    NEW.completed_at = now();
  ELSIF NEW.status <> 'complete' AND OLD.status = 'complete' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_completed_at ON public.journal_blocks;
CREATE TRIGGER trg_set_completed_at
  BEFORE UPDATE ON public.journal_blocks
  FOR EACH ROW EXECUTE FUNCTION set_completed_at();
