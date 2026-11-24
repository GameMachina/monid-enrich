CREATE TABLE IF NOT EXISTS enrichable.enrichment_jobs (
  workspace_id text NOT NULL REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  idempotency_key text NOT NULL,
  actor_id text NOT NULL,
  sheet_id text NOT NULL,
  row_id text NOT NULL,
  column_id text NOT NULL,
  input_fingerprint text NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','uncertain','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,idempotency_key),
  FOREIGN KEY (workspace_id,sheet_id) REFERENCES enrichable.sheets(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS enrichment_jobs_queue ON enrichable.enrichment_jobs(status,created_at) WHERE status IN ('queued','running');
