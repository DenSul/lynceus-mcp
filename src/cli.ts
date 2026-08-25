#!/usr/bin/env node
/**
 * lynceus-mcp CLI.
 *
 *   lynceus-mcp            stdio transport (default; for Claude Code,
 *                          Codex, Cursor, Hermes…)
 *   lynceus-mcp --http     Streamable HTTP on PORT (default 8082),
 *                          endpoint POST /mcp
 *
 * Env:
 *   LYNCEUS_API_URL   default https://api.lynceus.ru
 *   LYNCEUS_API_KEY   sk_live_…
 */

import { createServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from './api.js';
import { createServer as createMcp } from './server.js';

const args = process.argv.slice(2);
const useHttp = args.includes('--http');
const port = Number(process.env.PORT ?? 8082);

// DNS-rebinding guard for the HTTP transport: the server binds
// loopback, but a page on evil.com can still point "evil.com" at
// 127.0.0.1 in the public DNS and make the browser POST here. Browsers
// always send a Host header; reject anything outside the allowlist.
// Stdio is unaffected (no socket).
const HOST_ALLOWLIST = new Set([
  'localhost',
  '127.0.0.1',
  `[::1]:${port}`,
  `localhost:${port}`,
  `127.0.0.1:${port}`,
]);

const api = createClient();
const mcp = createMcp(api);

if (useHttp) {
  // Streamable HTTP via the SDK's Express adapter mounted on node:http.
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );
  const server = createServer(async (req, res) => {
    if (!HOST_ALLOWLIST.has(req.headers.host ?? '')) {
      res.statusCode = 403;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'host not allowed' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/mcp') {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless mode
          enableJsonResponse: true,
        });
        res.on('close', () => void transport.close());
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: String(e) }, id: null }));
      }
      return;
    }
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'MCP endpoint is POST /mcp' }));
  });
  server.listen(port, '127.0.0.1', () => {
    console.error(`lynceus-mcp: HTTP transport on 127.0.0.1:${port} (POST /mcp)`);
  });
} else {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  // Logs must never touch stdout — it is the protocol channel.
  console.error('lynceus-mcp: stdio transport ready');
}
