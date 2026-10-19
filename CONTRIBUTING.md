# Contributing to Dash

Thanks for helping. Dash runs on a wall-mounted screen all day, so changes should stay light on CPU, degrade gracefully when a source is down, and keep every on-screen string translatable.

## Getting started

```bash
nvm install && nvm use      # Node 22+
npm install
cp config.example.json config.json
npm run dev:demo            # server + Vite with simulated live games
```

Before opening a pull request:

```bash
npm test                    # unit tests (node:test, no extra dependencies)
npm run typecheck
npm run build
```

## Common contributions

**A new language.** Copy `locales/en.json` to `locales/<code>.json` and translate the values; missing keys fall back to English. Optionally add `locales/quotes/<code>.json`. If the language needs different ordinals ("1st", "1º") or ranking labels, extend `ord()`/`rank()` in `server/lib/i18n.js` and `web/src/i18n.ts`. `tests/i18n.test.js` checks that Spanish has every English key; add your language there too.

**A new competition** (anything ESPN covers). Add a line to `LEAGUES` in `server/catalog.js` with its ESPN slug, sport and kind. For a domestic football league, also map its country prefix in `candidateCompetitions()` so clubs pick up their cups and continental competitions. Add a translation in `locales/*.json → leagues` only if the name differs by language.

**A new data source.** Providers live in `server/providers/`. A sports provider implements `listTeams`, `resolveTeam`, `getTeamOverview` and `getScoreboard` (see `server/providers/sports/provider.js`) and returns the normalized `Game` shape. Register it in `server/providers/sports/index.js`. Probe the real API first and keep a small fixture-based test for its parsing.

## Guidelines

- No user-facing literals in code: use `t('key')` and add the key to every file in `locales/`.
- A failed refresh must keep the previous data (`store.fail`) and never blank the screen.
- Prefer CSS transforms and opacity for motion; the target hardware is a Surface Go 2.
- Keep dependencies minimal. The server has two (Express and fast-xml-parser).
- Only use free endpoints that need no API key.
