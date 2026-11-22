-- AgentWeb credentials belong to a signed-in member, not to a shared workspace.
CREATE TABLE IF NOT EXISTS enrichable.agentweb_connections (
  issuer text NOT NULL,
  user_id text NOT NULL,
  encrypted_key text NOT NULL,
  key_prefix text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (issuer, user_id)
);
