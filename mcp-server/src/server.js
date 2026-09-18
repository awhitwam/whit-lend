import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { Session } from './session.js';
import { SERVER_INSTRUCTIONS, DATA_CAVEATS_RESOURCE } from './caveats.js';
import { registerLoanTools } from './tools/loans.js';
import { registerBorrowerTools } from './tools/borrowers.js';
import { registerPaymentTools } from './tools/payments.js';

// stdout is the JSON-RPC channel. Anything written there corrupts the protocol,
// so all logging goes to stderr.
const log = (...args) => console.error('[whitlend-mcp]', ...args);

export function buildServer(session = new Session()) {
  const server = new McpServer(
    { name: 'whitlend', version: config.version },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerResource(
    'data-caveats',
    'whitlend://data-caveats',
    {
      title: 'WhitLend data caveats',
      description: 'Which stored figures are trustworthy, which are not, and why.',
      mimeType: 'text/markdown'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DATA_CAVEATS_RESOURCE }]
    })
  );

  registerLoanTools(server, session);
  registerBorrowerTools(server, session);
  registerPaymentTools(server, session);

  // Every tool goes through one error boundary: a failure must come back as tool
  // content, never as a thrown exception that kills the transport.
  for (const tool of Object.values(server._registeredTools ?? {})) {
    const original = tool.callback;
    tool.callback = async (...args) => {
      try {
        return await original(...args);
      } catch (err) {
        log('tool error:', err?.stack || err);
        const detail = err?.message || String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `Could not complete that query.\n\n${detail}` }]
        };
      }
    };
  }

  return { server, session };
}

export async function main() {
  const { server, session } = buildServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    try {
      await session.close();
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect before authenticating, so the server always appears in the client and a
  // connectivity problem surfaces as a readable tool error rather than a dead pipe.
  await server.connect(transport);
  log(`ready (read-only, ${config.pii} PII posture, max ${config.maxRows} rows/tool)`);
}
