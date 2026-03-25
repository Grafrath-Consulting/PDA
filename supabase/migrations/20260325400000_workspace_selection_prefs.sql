-- Store workspace multi-select preferences
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ws_select_mode boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ws_selected_ids uuid[] NOT NULL DEFAULT '{}';
