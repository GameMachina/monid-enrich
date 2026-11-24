CREATE TABLE IF NOT EXISTS enrichable.workspace_request_limits (
  workspace_id text NOT NULL REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  subject_id text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (workspace_id,subject_id,window_start)
);
CREATE INDEX IF NOT EXISTS workspace_request_limits_window ON enrichable.workspace_request_limits(window_start);
