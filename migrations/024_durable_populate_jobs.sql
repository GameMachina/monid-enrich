CREATE TABLE IF NOT EXISTS enrichable.populate_jobs (
  workspace_id text NOT NULL REFERENCES enrichable.workspaces(id) ON DELETE CASCADE,
  id text NOT NULL,
  idempotency_key text NOT NULL,
  input_fingerprint text NOT NULL,
  actor_id text NOT NULL,
  sheet_id text NOT NULL,
  request jsonb,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','uncertain','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  progress text NOT NULL DEFAULT 'Queued',
  added integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  completion_message text,
  error text,
  failure jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (workspace_id,id),
  UNIQUE (workspace_id,idempotency_key),
  FOREIGN KEY (workspace_id,sheet_id) REFERENCES enrichable.sheets(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS populate_jobs_queue ON enrichable.populate_jobs(status,created_at) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS populate_jobs_workspace_sheet ON enrichable.populate_jobs(workspace_id,sheet_id,created_at DESC);

CREATE TABLE IF NOT EXISTS enrichable.durable_worker_slots (
  slot_id integer PRIMARY KEY CHECK (slot_id BETWEEN 1 AND 20),
  workspace_id text,
  job_id text,
  lease_owner text,
  lease_expires_at timestamptz,
  CHECK ((workspace_id IS NULL AND job_id IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
      OR (workspace_id IS NOT NULL AND job_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  UNIQUE (workspace_id,job_id)
);
INSERT INTO enrichable.durable_worker_slots (slot_id)
SELECT slot_id FROM generate_series(1,20) AS slots(slot_id)
ON CONFLICT (slot_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS durable_worker_slots_expiry ON enrichable.durable_worker_slots(lease_expires_at) WHERE lease_expires_at IS NOT NULL;
