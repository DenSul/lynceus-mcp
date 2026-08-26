# lynceus-mcp

[![npm](https://img.shields.io/badge/npm-lynceus--mcp-blue)](https://www.npmjs.com/package/lynceus-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Web search and URL→Markdown extraction for AI agents. RU-web-first, anti-bot hardened, clean reader-mode output.

- `lyn_search` — live web search (RU-web-first), freshness filter
- `lyn_extract` — URLs → clean Markdown; gets through where plain fetch gets a 403
- `lyn_usage` — remaining credits

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

## Environment

| Variable | Default | Notes |
|---|---|---|
| `LYNCEUS_API_KEY` | — | Required |
| `LYNCEUS_API_URL` | `https://api.lynceus.ru` | Override for self-hosted |
| `LYNCEUS_TIMEOUT_MS` | `120000` | Per-call timeout |

## License

MIT © 2026 Lynceus
