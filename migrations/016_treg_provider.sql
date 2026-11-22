-- Treg has its own encrypted workspace credential and separate call receipts/billing history.
ALTER TABLE enrichable.organization_providers DROP CONSTRAINT IF EXISTS organization_providers_provider_check;
ALTER TABLE enrichable.organization_providers ADD CONSTRAINT organization_providers_provider_check CHECK (provider IN ('openai','monid','treg'));
ALTER TABLE enrichable.monid_runs ADD COLUMN IF NOT EXISTS data_provider text NOT NULL DEFAULT 'monid';

CREATE TABLE IF NOT EXISTS enrichable.treg_runs (
 workspace_id text NOT NULL REFERENCES enrichable.workspaces(id),
 call_id text NOT NULL,
 idempotency_key text,
 data_provider text NOT NULL DEFAULT 'treg' CHECK (data_provider = 'treg'),
 operation text NOT NULL,
 endpoint text NOT NULL,
 status text NOT NULL,
 input_hash text NOT NULL,
 cost_usd numeric,
 cost_micro_usd numeric,
 served_via text,
 error text,
 created_at bigint NOT NULL,
 updated_at bigint NOT NULL,
 PRIMARY KEY (workspace_id, call_id)
);
CREATE INDEX IF NOT EXISTS treg_runs_workspace_time ON enrichable.treg_runs (workspace_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS treg_runs_workspace_idempotency ON enrichable.treg_runs (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
