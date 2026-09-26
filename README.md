# Paseo Refined

A calm, cross-platform interface refinement plugin for Paseo 0.9.2 and newer.

## What it changes

- Adds the `Zinc Light`, `Zinc Focus`, and AMOLED-friendly `OLED Black` themes.
- Replaces reasoning rows with calm, collapsible cards.
- Replaces tool calls with compact status cards that expand on demand.
- Groups long consecutive tool runs into one compact card while preserving every tool's details.
- Adds searchable command output and readable unified diffs.
- Cleans terminal ANSI codes, formats JSON, and specializes search and subagent details.
- Uses lighter rows for completed read, search, and fetch operations.
- Uses React Native primitives and adaptive layout rules across mobile, web, and desktop.
- Supports English and Simplified Chinese, with automatic device-locale detection or a manual override.

## Use

```bash
npm install
npm run typecheck
paseo plugin install /absolute/path/to/paseo-refined
```

Choose a theme under **Settings → Appearance**. Timeline cards activate while the plugin is enabled.

Open **Settings → Plugins → Paseo Refined → Paseo Refined** to configure tool grouping and the
plugin language. The default threshold is 7 calls, so runs of 1–6 stay visible.
