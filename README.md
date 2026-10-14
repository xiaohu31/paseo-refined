# Paseo Refined

A calm, cross-platform interface refinement plugin for Paseo `>=0.9.2 <1.0.0`.

## Compatibility policy

Paseo Refined supports the complete pre-1.0 Paseo series instead of requiring a manifest edit for
every minor daemon update. Host contributions are registered independently: if a future 0.x runtime
removes or temporarily lacks one API, that feature is skipped with a warning while the rest of the
plugin continues loading. Paseo 1.0 remains an explicit compatibility boundary and will require a
normal review before the range is widened.

## Install

Install directly from GitHub:

```bash
paseo plugin install github:xiaohu31/paseo-refined
```

You can also paste `github:xiaohu31/paseo-refined` into **Settings → Plugins → Plugin source**.

Or install the published npm package:

```bash
paseo plugin install npm:paseo-refined
```

The npm source can likewise be pasted into the Plugin source field.

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
- `npm test` also locks the pre-1.0 compatibility range and verifies graceful degradation when a
  host contribution is unavailable.
- The remaining tests cover grouping thresholds, turn boundaries, language re-projection, renderer
  snapshots, newest-tool visibility, settings migration, and long-detail handling.
- `npm pack --dry-run` shows the exact publication payload; tests are excluded from the package.

## License

MIT
