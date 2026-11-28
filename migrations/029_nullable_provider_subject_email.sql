-- Clerk sessions do not always include an email claim. Connection ownership is
-- still attributed by subject_id, so the email metadata must be optional.
ALTER TABLE enrichable.organization_providers
 ALTER COLUMN subject_email DROP NOT NULL;
