ALTER TABLE enrichable.workspaces ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS workspaces_active ON enrichable.workspaces(id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS enrichable.workspace_audit_events (
  workspace_id text NOT NULL REFERENCES enrichable.workspaces(id),
  id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('workspace.export','workspace.close')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id)
);
CREATE INDEX IF NOT EXISTS workspace_audit_events_recent ON enrichable.workspace_audit_events(workspace_id,created_at DESC);
