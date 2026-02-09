-- OAuth tables for MCP server authentication
-- Run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor)

-- 1. OAuth Clients (Dynamic Client Registration)
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret TEXT,
  client_id_issued_at BIGINT,
  client_secret_expires_at BIGINT DEFAULT 0,
  redirect_uris JSONB NOT NULL DEFAULT '[]',
  client_name TEXT,
  token_endpoint_auth_method TEXT DEFAULT 'client_secret_post',
  grant_types JSONB DEFAULT '["authorization_code"]',
  response_types JSONB DEFAULT '["code"]',
  scope TEXT
);

-- 2. OAuth Authorization Codes (short-lived, 10 min TTL)
CREATE TABLE oauth_authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes JSONB DEFAULT '[]',
  state TEXT,
  resource TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

-- 3. OAuth Tokens (access + refresh)
CREATE TABLE oauth_tokens (
  token TEXT PRIMARY KEY,
  token_type TEXT NOT NULL CHECK (token_type IN ('access', 'refresh')),
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scopes JSONB DEFAULT '[]',
  resource TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  related_token TEXT
);

-- Index for token lookups during verification
CREATE INDEX idx_oauth_tokens_access_lookup
  ON oauth_tokens (token, token_type, revoked)
  WHERE token_type = 'access' AND revoked = FALSE;
