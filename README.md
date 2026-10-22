# lynceus-mcp

[![npm](https://img.shields.io/badge/npm-lynceus--mcp-blue)](https://www.npmjs.com/package/lynceus-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Web search and URL→Markdown extraction for AI agents. RU-web-first: strong on Russian-language and .ru content, with real anti-bot bypass and clean reader-mode output.

- `lyn_search` — live web search (RU-web-first), freshness filter
- `lyn_images` — image search by text query: direct image URLs, dimensions, source pages (2 credits; cache hits free)
- `lyn_extract` — URLs → clean Markdown; gets through where plain fetch gets a 403
- `lyn_research` — deep research: one question → Lynceus plans queries, reads up to 12 pages and synthesizes a cited Markdown report (300 credits; refunded if synthesis fails; async job with live progress)
- `lyn_usage` — remaining credits

> **opencode and other clients with hard ~60s tool timeouts:** call `lyn_research` with `wait: false` and poll `GET /v1/research/jobs/<job_id>`. The default blocking mode sends MCP progress notifications every 20s, which spec-compliant clients (Claude Code, Cursor) treat as activity. opencode kills the request anyway; the job keeps running server-side and the report is not lost.

## Install

```bash
npm i -g lynceus-mcp
```

Get an API key at [lynceus.ru](https://lynceus.ru) — free tier includes 300 credits.

## Connect your agent

<details open>
<summary><b>Claude Code</b> (<code>.mcp.json</code>)</summary>

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
<summary><b>Windsurf</b> (<code>~/.codeium/windsurf/mcp_config.json</code>)</summary>

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
<summary><b>Streamable HTTP</b></summary>

```bash
LYNCEUS_API_KEY=sk_live_... lynceus-mcp --http   # POST /mcp on :8082
```
</details>

## Reading long documents and tables

`lyn_extract` returns bounded pages. `max_chars` counts Unicode characters in
original Markdown, with the API default of 8000 characters when omitted. MCP
limits explicit requests to 48,000 characters per URL (up to 10 URLs per call).
Larger requests are reduced to that limit before calling the API.

When a result says `TRUNCATED — call again with offset:N`, repeat `lyn_extract`
for that URL with `offset: N` and concatenate the page bodies. Keep following
the returned cursor until the result is no longer truncated. A page boundary
can split a long table, so individual continuations may not contain its header.

Always reuse `next_offset`; do not calculate it from the displayed body length.
Emoji use two JavaScript UTF-16 units, security filtering can change text length,
and `format: "text"` still uses offsets in the original Markdown. MCP sanitizes
and fences every returned window in full, without a second body truncation.
An oversized API page or a non-advancing/out-of-window cursor is reported as an
error rather than returning incomplete content with a misleading continuation.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `LYNCEUS_API_KEY` | — | Required |
| `LYNCEUS_API_URL` | `https://api.lynceus.ru` | Override for self-hosted |
| `LYNCEUS_TIMEOUT_MS` | `120000` | Per-call timeout |

## License

MIT © 2026 Lynceus
