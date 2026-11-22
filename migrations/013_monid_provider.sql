-- Only OpenAI (user supplied, reasoning only) and Monid (data provider) are supported connections.
DELETE FROM enrichable.organization_providers WHERE provider NOT IN ('openai', 'monid');
ALTER TABLE enrichable.organization_providers DROP CONSTRAINT IF EXISTS organization_providers_provider_check;
ALTER TABLE enrichable.organization_providers ADD CONSTRAINT organization_providers_provider_check CHECK (provider IN ('openai','monid'));

-- Monid run receipts are stored per app workspace. Inputs are represented by a hash so sensitive row data is not duplicated.
CREATE TABLE IF NOT EXISTS enrichable.monid_runs (
 workspace_id text NOT NULL REFERENCES enrichable.workspaces(id),
 run_id text NOT NULL,
 provider text NOT NULL,
 endpoint text NOT NULL,
 status text NOT NULL,
 input_hash text NOT NULL,
 cost_usd numeric,
 billed_units numeric,
 price jsonb,
 result_count integer,
 error jsonb,
 created_at bigint NOT NULL,
 updated_at bigint NOT NULL,
 PRIMARY KEY (workspace_id, run_id)
);
CREATE INDEX IF NOT EXISTS monid_runs_workspace_time ON enrichable.monid_runs (workspace_id, created_at DESC);
