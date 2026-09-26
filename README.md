# Paseo Refined

A calm, cross-platform interface refinement plugin for Paseo `>=0.9.2 <0.10.0`.

## What it changes

- Adds the `Zinc Light`, `Zinc Focus`, and AMOLED-friendly `OLED Black` themes.
- Replaces reasoning rows with calm, collapsible cards.
- Replaces tool calls with compact status cards that expand on demand.
- Groups long consecutive tool runs into one compact card while preserving every tool's full details.
- Adds searchable command output and readable unified diffs.
- Cleans terminal ANSI codes, formats JSON, and specializes search and subagent details.
- Uses lighter rows for completed read, search, and fetch operations.
- Uses React Native primitives and adaptive layout rules across mobile, web, and desktop.
- Supports English and Simplified Chinese, with automatic device-locale detection or a manual override.
- Respects the operating system's Reduce Motion preference and adds explicit accessibility labels for tool states.

## Install from a local checkout

```bash
npm install
npm run typecheck
npm test
paseo plugin install /absolute/path/to/paseo-refined
```

Paseo plugins are trusted code. The client contribution runs inside the Paseo app, and this
plugin's small server contribution only registers host-scoped settings persistence.

After editing the source, validate and reload it:

```bash
npm run typecheck
npm test
paseo plugin reload paseo-refined
```

## Configure

Choose a theme under **Settings → Appearance**. Timeline cards activate while the plugin is enabled.

Open **Settings → Plugins → Paseo Refined → Paseo Refined** to configure tool grouping and the
plugin language. The default threshold is 7 calls, so runs of 1–6 stay visible.

Grouped tools expand in place to keep the conversation's scroll position stable. Selecting one
tool opens its focused details view. Long payloads stay compact in the timeline and are formatted
in full only when details are opened.

## Development

- `npm run typecheck` validates the plugin SDK and React Native contracts.
- `npm test` covers grouping thresholds, turn boundaries, language re-projection, renderer
  snapshots, newest-tool visibility, settings migration, and long-detail handling.
- `npm pack --dry-run` shows the exact publication payload; tests are excluded from the package.

The package intentionally remains private until the repository URL, author, and open-source
license are selected for the first public release.
