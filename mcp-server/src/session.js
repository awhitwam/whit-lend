import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { createGuardedFetch, createReadOnlyDb } from './db.js';

/**
 * Session and organization resolution.
 *
 * The anon key alone returns nothing: every business table's RLS policy is
 * `organization_id IN (SELECT user_org_ids())` and user_org_ids() reads auth.uid()
 * (supabase/migrations/026_complete_rls_policies.sql). So the server must hold a real
 * signed-in session. No RLS policy references MFA assurance level, so an AAL1
 * password session satisfies every policy.
 */

const REAUTH_THROTTLE_MS = 30_000;

/** Copied from src/api/dataClient.js:19-28 - that module cannot be imported (import.meta.env). */
function isSessionError(error) {
  if (!error) return false;
  if (error.code === '42501') return true;   // RLS violation, usually an expired JWT
  if (error.code === 'PGRST301') return true; // JWT expired
  if (error.status === 401) return true;
  const msg = error.message || '';
  if (msg.includes('JWT') && msg.includes('expired')) return true;
  if (msg.includes('Invalid JWT')) return true;
  return false;
}

export class Session {
  constructor() {
    this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        // In-memory only: no rotated refresh token left on disk.
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false
      },
      global: {
        fetch: createGuardedFetch(),
        headers: { 'X-Client-Info': `whitlend-mcp/${config.version}` }
      }
    });
    this.user = null;
    this.org = null;
    this.db = null;
    this.lastAuthAttempt = 0;
    this.lastAuthError = null;
    this.ready = null;
  }

  async signIn() {
    const since = Date.now() - this.lastAuthAttempt;
    if (this.lastAuthError && since < REAUTH_THROTTLE_MS) {
      throw new Error(`Sign-in failed ${Math.round(since / 1000)}s ago: ${this.lastAuthError}`);
    }
    this.lastAuthAttempt = Date.now();

    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: config.email,
      password: config.password
    });

    if (error) {
      this.lastAuthError = error.message;
      throw new Error(
        `Could not sign in as ${config.email}: ${error.message}\n` +
        'Check WHITLEND_MCP_EMAIL / WHITLEND_MCP_PASSWORD in mcp-server/.env, and that the ' +
        'account is confirmed in the Supabase dashboard.'
      );
    }
    this.lastAuthError = null;
    this.user = data.user;
    return data.user;
  }

  /**
   * A super-admin account sees every organization (is_super_admin() widens RLS in
   * migration 040), which silently destroys tenant isolation. Refuse to serve.
   */
  async assertNotSuperAdmin() {
    const { data, error } = await this.supabase
      .from('user_profiles')
      .select('is_super_admin')
      .eq('id', this.user.id)
      .maybeSingle();

    if (error && !isSessionError(error)) {
      // A missing profile row is not fatal; a super-admin flag we cannot read is.
      throw new Error(`Could not read user_profiles for the MCP account: ${error.message}`);
    }
    if (data?.is_super_admin) {
      throw new Error(
        `The account ${config.email} is flagged is_super_admin, which widens row-level ` +
        'security to every organization. Use a non-super-admin account for this server.'
      );
    }
  }

  async resolveOrganization() {
    const { data, error } = await this.supabase
      .from('organization_members')
      .select('organization_id, role, organizations(id, name)')
      .eq('user_id', this.user.id)
      .eq('is_active', true);

    if (error) throw new Error(`Could not read organization membership: ${error.message}`);

    const memberships = (data || []).filter((m) => m.organization_id);
    if (memberships.length === 0) {
      throw new Error(
        `The account ${config.email} has no active organization membership. Add it to ` +
        "organization_members with role 'Viewer' - see mcp-server/README.md."
      );
    }

    let chosen;
    if (memberships.length === 1) {
      chosen = memberships[0];
    } else if (config.orgId) {
      chosen = memberships.find((m) => m.organization_id === config.orgId);
      if (!chosen) {
        throw new Error(
          `WHITLEND_ORG_ID=${config.orgId} is not one of this account's organizations:\n` +
          memberships.map((m) => `  ${m.organization_id}  ${m.organizations?.name ?? ''}`).join('\n')
        );
      }
    } else {
      throw new Error(
        'This account belongs to more than one organization. Set WHITLEND_ORG_ID in ' +
        'mcp-server/.env to one of:\n' +
        memberships.map((m) => `  ${m.organization_id}  ${m.organizations?.name ?? ''}`).join('\n')
      );
    }

    this.org = {
      id: chosen.organization_id,
      name: chosen.organizations?.name || chosen.organization_id,
      role: chosen.role
    };
    this.db = createReadOnlyDb(this.supabase, this.org.id);
    return this.org;
  }

  /**
   * Authentication is lazy: the transport connects first so the server always appears
   * in the client, and a connectivity problem surfaces as a tool error rather than a
   * dead connection.
   */
  async ensureReady() {
    if (this.db) return this;
    if (!this.ready) {
      this.ready = (async () => {
        await this.signIn();
        await this.assertNotSuperAdmin();
        await this.resolveOrganization();
        return this;
      })().catch((err) => {
        this.ready = null; // allow a later retry
        throw err;
      });
    }
    return this.ready;
  }

  /**
   * Runs a query, and on a session failure signs in once and retries once. Everything
   * that touches the database goes through here.
   */
  async run(fn) {
    await this.ensureReady();
    try {
      return await fn(this.db);
    } catch (err) {
      if (!isSessionError(err)) throw err;
      await this.signIn();
      return fn(this.db);
    }
  }

  async close() {
    try {
      await this.supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Shutting down anyway.
    }
  }
}

export { isSessionError };
