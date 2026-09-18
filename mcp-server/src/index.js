#!/usr/bin/env node
// Thin launcher. The real server is loaded dynamically so a configuration problem
// (a missing .env, say) reports as one readable line on stderr rather than as an
// unhandled module-level exception with a stack trace.
try {
  const { main } = await import('./server.js');
  await main();
} catch (err) {
  console.error(`[whitlend-mcp] cannot start: ${err?.message ?? err}`);
  if (process.env.WHITLEND_MCP_DEBUG) console.error(err);
  process.exit(1);
}
