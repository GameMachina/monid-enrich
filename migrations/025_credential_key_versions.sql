ALTER TABLE enrichable.organization_providers
  ADD COLUMN IF NOT EXISTS encryption_key_id text NOT NULL DEFAULT 'legacy';

ALTER TABLE enrichable.agentweb_connections
  ADD COLUMN IF NOT EXISTS encryption_key_id text NOT NULL DEFAULT 'legacy';

ALTER TABLE enrichable.mcp_keys
  ADD COLUMN IF NOT EXISTS encryption_key_id text NOT NULL DEFAULT 'legacy';
