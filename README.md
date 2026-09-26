# Paseo Mobile Polish

A mobile-first visual polish plugin for Paseo 0.9.2 and newer.

## What it changes

- Adds the `Zinc Light`, `Zinc Focus`, and AMOLED-friendly `OLED Black` themes.
- Replaces reasoning rows with calm, collapsible cards.
- Replaces tool calls with compact status cards that expand on demand.
- Groups long consecutive tool runs into one compact card while preserving every tool's details.
- Adds searchable command output and mobile-friendly unified diffs.
- Cleans terminal ANSI codes, formats JSON, and specializes search and subagent details.
- Uses lighter rows for completed read, search, and fetch operations.
- Uses React Native primitives and compact layout rules across mobile, web, and desktop.

## Use

```bash
npm install
npm run typecheck
paseo plugin install /absolute/path/to/paseo-mobile-polish
```

Choose a theme under **Settings → Appearance**. Timeline cards activate while the plugin is enabled.

Open **Settings → Plugins → Paseo Mobile Polish → Paseo Refined** to enable or disable tool
grouping and choose its threshold. The default is 7 calls, so runs of 1–6 stay visible.
