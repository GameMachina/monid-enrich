-- Retire Treg credentials and restore the supported workspace-provider set.
-- Keep enrichable.treg_runs intact so previously billed work remains auditable.
ALTER TABLE enrichable.organization_providers DROP CONSTRAINT IF EXISTS organization_providers_provider_check;
DELETE FROM enrichable.organization_providers WHERE provider = 'treg';
ALTER TABLE enrichable.organization_providers
 ADD CONSTRAINT organization_providers_provider_check CHECK (provider IN ('openai','monid'));
