import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

class SupabaseClientsStore {
  async getClient(clientId) {
    const { data, error } = await supabase
      .from('oauth_clients')
      .select('*')
      .eq('client_id', clientId)
      .single();

    if (error || !data) return undefined;

    return {
      client_id: data.client_id,
      client_secret: data.client_secret,
      client_id_issued_at: data.client_id_issued_at,
      client_secret_expires_at: data.client_secret_expires_at,
      redirect_uris: data.redirect_uris,
      client_name: data.client_name,
      token_endpoint_auth_method: data.token_endpoint_auth_method,
      grant_types: data.grant_types,
      response_types: data.response_types,
      scope: data.scope,
    };
  }

  async registerClient(client) {
    const clientId = crypto.randomUUID();
    const clientSecret = crypto.randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    const record = {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: now,
      client_secret_expires_at: 0,
      redirect_uris: client.redirect_uris,
      client_name: client.client_name || null,
      token_endpoint_auth_method:
        client.token_endpoint_auth_method || 'client_secret_post',
      grant_types: client.grant_types || ['authorization_code'],
      response_types: client.response_types || ['code'],
      scope: client.scope || null,
    };

    const { error } = await supabase.from('oauth_clients').insert(record);
    if (error) throw new Error(`Failed to register client: ${error.message}`);

    return record;
  }
}

export class SupabaseOAuthProvider {
  constructor() {
    this._clientsStore = new SupabaseClientsStore();
  }

  get clientsStore() {
    return this._clientsStore;
  }

  async authorize(client, params, res) {
    const code = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('oauth_authorization_codes')
      .insert({
        code,
        client_id: client.client_id,
        redirect_uri: params.redirectUri,
        code_challenge: params.codeChallenge,
        scopes: params.scopes || [],
        state: params.state || null,
        resource: params.resource ? params.resource.toString() : null,
        expires_at: expiresAt,
      });

    if (error) throw new Error(`Failed to store authorization code: ${error.message}`);

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (params.state) {
      redirectUrl.searchParams.set('state', params.state);
    }

    res.redirect(redirectUrl.toString());
  }

  async challengeForAuthorizationCode(client, authorizationCode) {
    const { data, error } = await supabase
      .from('oauth_authorization_codes')
      .select('code_challenge')
      .eq('code', authorizationCode)
      .eq('client_id', client.client_id)
      .single();

    if (error || !data) {
      throw new Error('Authorization code not found');
    }

    return data.code_challenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, codeVerifier, redirectUri, resource) {
    const { data, error } = await supabase
      .from('oauth_authorization_codes')
      .select('*')
      .eq('code', authorizationCode)
      .eq('client_id', client.client_id)
      .single();

    if (error || !data) {
      throw new Error('Authorization code not found');
    }

    if (new Date(data.expires_at) < new Date()) {
      await supabase.from('oauth_authorization_codes').delete().eq('code', authorizationCode);
      throw new Error('Authorization code expired');
    }

    await supabase.from('oauth_authorization_codes').delete().eq('code', authorizationCode);

    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const accessExpiry = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
    const refreshExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const tokenRecords = [
      {
        token: accessToken,
        token_type: 'access',
        client_id: client.client_id,
        scopes: data.scopes || [],
        resource: data.resource || null,
        expires_at: accessExpiry.toISOString(),
        revoked: false,
        related_token: refreshToken,
      },
      {
        token: refreshToken,
        token_type: 'refresh',
        client_id: client.client_id,
        scopes: data.scopes || [],
        resource: data.resource || null,
        expires_at: refreshExpiry.toISOString(),
        revoked: false,
        related_token: accessToken,
      },
    ];

    const { error: insertError } = await supabase.from('oauth_tokens').insert(tokenRecords);
    if (insertError) throw new Error(`Failed to store tokens: ${insertError.message}`);

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: (data.scopes || []).join(' '),
    };
  }

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('*')
      .eq('token', refreshToken)
      .eq('token_type', 'refresh')
      .eq('client_id', client.client_id)
      .eq('revoked', false)
      .single();

    if (error || !data) {
      throw new Error('Invalid refresh token');
    }

    if (new Date(data.expires_at) < new Date()) {
      throw new Error('Refresh token expired');
    }

    // Revoke old token pair
    await supabase
      .from('oauth_tokens')
      .update({ revoked: true })
      .in('token', [refreshToken, data.related_token]);

    const newAccessToken = crypto.randomBytes(32).toString('hex');
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const accessExpiry = new Date(now.getTime() + 60 * 60 * 1000);
    const refreshExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const tokenScopes = scopes || data.scopes || [];

    const tokenRecords = [
      {
        token: newAccessToken,
        token_type: 'access',
        client_id: client.client_id,
        scopes: tokenScopes,
        resource: data.resource || null,
        expires_at: accessExpiry.toISOString(),
        revoked: false,
        related_token: newRefreshToken,
      },
      {
        token: newRefreshToken,
        token_type: 'refresh',
        client_id: client.client_id,
        scopes: tokenScopes,
        resource: data.resource || null,
        expires_at: refreshExpiry.toISOString(),
        revoked: false,
        related_token: newAccessToken,
      },
    ];

    const { error: insertError } = await supabase.from('oauth_tokens').insert(tokenRecords);
    if (insertError) throw new Error(`Failed to store tokens: ${insertError.message}`);

    return {
      access_token: newAccessToken,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: tokenScopes.join(' '),
    };
  }

  async verifyAccessToken(token) {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('*')
      .eq('token', token)
      .eq('token_type', 'access')
      .eq('revoked', false)
      .single();

    if (error || !data) {
      throw new Error('Invalid access token');
    }

    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      throw new Error('Access token expired');
    }

    return {
      token: data.token,
      clientId: data.client_id,
      scopes: data.scopes || [],
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
      resource: data.resource ? new URL(data.resource) : undefined,
    };
  }

  async revokeToken(client, request) {
    await supabase
      .from('oauth_tokens')
      .update({ revoked: true })
      .eq('token', request.token)
      .eq('client_id', client.client_id);
  }
}
