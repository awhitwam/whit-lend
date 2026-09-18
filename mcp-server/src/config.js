import path from 'node:path';
import fs from 'node:fs';

// Claude Desktop launches the server with an arbitrary working directory, so the .env
// must be resolved relative to this file rather than to cwd.
const ENV_PATH = path.join(import.meta.dirname, '..', '.env');

if (fs.existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy mcp-server/.env.example to mcp-server/.env and fill it in ` +
      `(looked for ${ENV_PATH}).`
    );
  }
  return value;
};

const int = (name, fallback) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  envPath: ENV_PATH,
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  email: required('WHITLEND_MCP_EMAIL'),
  password: required('WHITLEND_MCP_PASSWORD'),
  // Only consulted when the account belongs to more than one organization
  orgId: process.env.WHITLEND_ORG_ID || null,
  // 'redacted' withholds borrower contact details unless a tool call opts in
  pii: process.env.WHITLEND_MCP_PII === 'full' ? 'full' : 'redacted',
  maxRows: int('WHITLEND_MCP_MAX_ROWS', 200),
  queryTimeoutMs: int('WHITLEND_MCP_TIMEOUT_MS', 20000),
  version: '0.1.0'
};
