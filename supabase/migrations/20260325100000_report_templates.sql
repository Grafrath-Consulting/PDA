-- Report templates for quick-run reports
CREATE TABLE report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name text NOT NULL,
  date_range_type text NOT NULL DEFAULT 'today',
  -- dynamic: 'today', 'yesterday', 'last_7', 'last_30', 'last_90'
  -- static: 'custom' (uses date_from/date_to)
  date_from date,
  date_to date,
  workspace_ids uuid[] NOT NULL DEFAULT '{}',
  -- empty = all workspaces
  include_ai_summary boolean NOT NULL DEFAULT false,
  summary_only boolean NOT NULL DEFAULT false,
  recipient_emails text[] NOT NULL DEFAULT '{}',
  entry_type_filter text, -- null=all, 'task', 'info'
  status_filter text, -- null=all, 'active', 'complete'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own templates" ON report_templates
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own templates" ON report_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own templates" ON report_templates
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own templates" ON report_templates
  FOR DELETE USING (auth.uid() = user_id);
