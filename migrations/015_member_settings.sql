CREATE TABLE IF NOT EXISTS enrichable.member_settings (
  workspace_id text NOT NULL REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  member_id text NOT NULL CHECK (member_id ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, member_id)
);
