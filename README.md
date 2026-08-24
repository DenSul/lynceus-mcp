# lynceus-mcp

[![npm](https://img.shields.io/badge/npm-lynceus--mcp-blue)](https://www.npmjs.com/package/lynceus-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-1.0%20spec-orange)](https://modelcontextprotocol.io)

**Web search and URL→Markdown extraction for AI agents — RU-web-first, anti-bot hardened.**

Lynceus is the argonaut who saw through walls. This MCP server gives your agent the same power: search the live web via the Yandex index (the deepest coverage of the Russian internet) and pull any page as clean reader-mode Markdown through a 4-tier anti-bot ladder that gets through where plain `fetch` gets a 403.

```
┌──────────────────────────────────────────────────────────┐
│  query ──▶ lyn_search ──▶ urls ──▶ lyn_extract ──▶ text  │
│            (yandex index)      (4-tier ladder:           │
│             RU-first            tls → adapters →         │
│                                 browser → captcha)       │
└──────────────────────────────────────────────────────────┘
```

## Tools

| Tool | What it does | Cost |
|---|---|---|
| `lyn_search` | Live web search, RU-first (Yandex index), freshness filter | 1 credit |
| `lyn_extract` | URLs → clean reader-mode Markdown, batches of 10 | 1 credit / URL |
| `lyn_usage` | Remaining credits check | free |

Tool descriptions are written *for the model* — when to reach for each tool, what every argument does, cost semantics, failure modes and retry hints. Your agent will call them right on the first try.

## Install

```bash
npm i -g lynceus-mcp
# or: npx lynceus-mcp
```

Get an API key at [lynceus.ru](https://lynceus.ru) — signup takes a minute, free tier includes 300 credits.

## Connect your agent

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add lynceus -- lynceus-mcp
# or in .mcp.json:
```

```json
{
  "mcpServers": {
    "lynceus": {
      "command": "npx",
      "args": ["-y", "lynceus-mcp"],
      "env": { "LYNCEUS_API_KEY": "sk_live_..." }
    }
  }
}
```
</details>

<details>
<summary><b>OpenAI Codex</b> (<code>~/.codex/config.toml</code>)</summary>

```toml
[mcp_servers.lynceus]
command = "npx"
args = ["-y", "lynceus-mcp"]
env = { LYNCEUS_API_KEY = "sk_live_..." }
```
</details>

<details>
<summary><b>Cursor</b> (<code>~/.cursor/mcp.json</code>)</summary>

```json
{
  "mcpServers": {
    "lynceus": {
      "command": "npx",
      "args": ["-y", "lynceus-mcp"],
      "env": { "LYNCEUS_API_KEY": "sk_live_..." }
    }
  }
}
```
</details>

<details>
<summary><b>Hermes Agent</b> (<code>~/.hermes/config.yaml</code>)</summary>

```yaml
mcp:
  lynceus:
    command: npx
    args: ["-y", "lynceus-mcp"]
    env:
      LYNCEUS_API_KEY: sk_live_...
```
</details>

<details>
<summary><b>Windsurf / Wits</b> (<code>~/.codeium/windsurf/mcp_config.json</code>)</summary>

```json
{
  "mcpServers": {
    "lynceus": {
      "command": "npx",
      "args": ["-y", "lynceus-mcp"],
      "env": { "LYNCEUS_API_KEY": "sk_live_..." }
    }
  }
}
```
</details>

<details>
<summary><b>VS Code (Copilot)</b> (<code>.vscode/mcp.json</code>)</summary>

```json
{
  "servers": {
    "lynceus": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "lynceus-mcp"],
      "env": { "LYNCEUS_API_KEY": "sk_live_..." }
    }
  }
}
```
</details>

<details>
<summary><b>Any MCP client (Streamable HTTP)</b></summary>

```bash
LYNCEUS_API_KEY=sk_live_... lynceus-mcp --http   # POST /mcp on :8082
```
</details>

## Environment

| Variable | Default | Notes |
|---|---|---|
| `LYNCEUS_API_KEY` | — | Required. `sk_live_…` |
| `LYNCEUS_API_URL` | `https://api.lynceus.ru` | Override for self-hosted |
| `LYNCEUS_TIMEOUT_MS` | `120000` | Per-call timeout |

## Why agents pick Lynceus

- **RU-web-first.** The Yandex index sees Russian content Google tools under-cover: regional sites, forums, habr-style blogs, .ru docs.
- **Gets through walls.** Chrome TLS fingerprint → site adapters (Habr RSS, Wikipedia REST, GitHub raw) → headless browser → optional ReCaptcha solving. Each page gets the cheapest tier that works.
- **Clean Markdown, not HTML soup.** Reader-mode extraction keeps the article, drops the nav/ads/footer noise — fewer tokens, better answers.
- **Honest billing.** 1 credit per search, 1 per extracted URL, cache hits are free, failures are never charged.

## Self-hosting

The API server is a separate Go service ([lynceus.ru](https://lynceus.ru) for the hosted one). Point `LYNCEUS_API_URL` at your own instance and keep the same MCP client everywhere.

## Development

```bash
git clone https://github.com/DenSul/lynceus-mcp && cd lynceus-mcp
npm i && npm run build && npm test
LYNCEUS_API_URL=http://localhost:8080 LYNCEUS_API_KEY=sk_live_... npm start
```

TypeScript, strict mode, zero runtime deps beyond the official MCP SDK and zod. Tests run the full JSON-RPC round-trip through an in-memory transport against a fake API — and there's a live smoke against a real instance in CI.

## License

MIT © 2026 Lynceus
