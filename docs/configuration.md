# Configuration

`config.json` is personal and gitignored. Without it, Dash runs from `config.example.json`. Most values can also be changed on screen (Settings) without a restart; when the same thing is set in both places, `config.json` wins on the next start.

Environment variables: `PORT`, `DASH_CONFIG=/path/to/config.json`, `DASH_DATA_DIR=/path/to/data`, `DASH_DEMO=1`, `GEMINI_API_KEY`, `SPOTIFY_CLIENT_ID`. They can also go in a `.env` file in the project folder (gitignored); real environment variables win.

## Keys

| Key | Meaning |
| --- | --- |
| `language` | UI and data language: `en`, `es`, `fr`, `pt` (Brazilian), `de`, `it`, or any file in `locales/` |
| `locale` | Optional date/number locale, e.g. `en-US`. Defaults to the language's locale. |
| `timezone` | IANA zone, e.g. `Europe/Madrid`. Defaults to the system time zone. |
| `clock24h` | `true` (default) or `false` for a 12-hour clock |
| `userName` | Used in the greeting ("Good afternoon, Alex · Dash") |
| `location` | `{ "mode": "auto" }` (device → IP → `fallback`) or `{ "mode": "fixed", "lat", "lon", "name" }` |
| `rotationSeconds`, `touchPauseSeconds` | Panel rotation and the pause after a touch |
| `nightMode` | `{ "enabled": true, "start": "23:00", "end": "07:00" }` |
| `refresh` | Refresh intervals. `liveActiveSeconds` applies while a game is live, `liveIdleSeconds` otherwise. |
| `news.sources` | RSS feeds `{ name, url }`. When empty, defaults are used per language and country. |
| `favorites` | Your teams, F1 drivers, tennis players and followed leagues (see below) |
| `liveLeagues` | Competitions whose live games (any teams) feed the Live panel and ticker, e.g. `{ "provider": "espn", "league": "eng.1" }` |
| `finance` | `{ "symbols": ["^GSPC", "AAPL", "BTC-USD", "EURUSD=X"], "refreshMinutes": 5, "newsSources": [] }`, using Yahoo Finance symbols. `newsSources` (RSS) overrides the default market news for your language. |
| `quote` | `{ "enabled": true }` |
| `sportsNews` | `{ "enabled": true, "perTeam": 4 }` |
| `features` | Switch each optional feature on or off: `alerts`, `airQuality`, `uv`, `holidays`, `moon`, `electricity`, `reminders`, `countdowns`, `whereToWatch`, `preMatch` (kickoff toast and Preview panel), `matchday` (round results), `brackets`, `radar`, `calendar`, `cooking`, `spotify`, `assistant`, `motion` (wake on motion), `wifiQr`. All are on except `wifiQr`, `assistant` and `motion`. |
| `alerts` | `{ "areas": [] }`: weather warnings (MeteoAlarm in Europe, NWS in the US) are matched to your location by area name. To pin exact zones, list their MeteoAlarm EMMA_ID codes or names. |
| `electricity` | `{ "region": "peninsula" }`: PVPC price zone (`peninsula`, `canarias`, `baleares`, `ceuta`, `melilla`). Only fetched when the display is in Spain. |
| `countdowns` | `{ "withinDays": 30 }`: how far ahead countdowns show in the Today strip |
| `radar` | `{ "showWhen": "rain", "tiles": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "attribution": "© OpenStreetMap" }`: `showWhen` is `rain` (the radar panel joins the rotation only when rain is likely) or `always`. For heavy use, point `tiles` to your own tile server. |
| `calendar` | `{ "urls": [], "days": 14 }`: iCal links as strings or `{ "name", "url", "color" }`. Google Calendar: Settings → your calendar → "Secret address in iCal format". iCloud: share as a public calendar. `webcal://` links work. These links are private: keep them only in `config.json`. |
| `cooking` | `{ "model": "gemini-3.8-flash" }`: the Gemini model that reads recipe pages without a recipe card and translates the "What to cook" ideas (only with `GEMINI_API_KEY`). |
| `briefing` | `{ "time": null, "weekdays": [1, 2, 3, 4, 5, 6, 0] }`: when the assistant says good morning by itself (`"07:30"`; `null` = only when asked). 0 = Sunday. |
| `bins` | `[{ "name": "Recycling", "weekdays": [2, 5], "evening": true }]`: collection days for the Today strip and the briefing. `evening: true` reminds you the evening before. |
| `spotify` | `{ "clientId": "" }`: the Client ID of your own Spotify app. See [Spotify](#spotify). |
| `assistant` | `{ "model": "gemini-3.8-live", "voice": "Kore", "wakeWords": ["dash"], "idleSeconds": 8, "allowRemote": false }`. See [Voice assistant](voice-assistant.md). |
| `motion` | `{ "dimAfterMinutes": 10, "sensitivity": "medium" }`: wake on motion (enable with `features.motion`). `dimAfterMinutes: 0` never dims, only wakes; `sensitivity` is `low`, `medium` or `high`. |
| `wifi` | `{ "ssid": "", "password": "", "security": "WPA", "hidden": false }`: the guest network for the QR code (`security`: `WPA`, `WEP` or `nopass`). Enable with `features.wifiQr`. |
| `watchdog` | `{ "maxMemoryMB": 700, "dailyReload": "04:00" }`: restart the server above this memory, and reload the page daily at this time (`null` to disable) |

## Favourites

```json
"favorites": {
  "teams": [
    { "key": "arsenal", "league": "eng.1", "name": "Arsenal" },
    { "key": "lakers", "league": "nba", "name": "Los Angeles Lakers", "displayName": "Lakers", "color": "#552583" }
  ],
  "drivers": [{ "id": "alonso", "name": "Fernando Alonso" }],
  "players": [{ "id": "3782", "name": "Carlos Alcaraz", "tour": "atp" }],
  "leagues": ["esp.1", "nba"]
}
```

- **Teams**: `league` is any key from the competitions table and is only where Dash looks the team up by `name`. Dash then finds every competition the team plays in (a club's league, cups and continental competitions; a national team's tournaments, qualifiers and friendlies) and keeps the ones with recent or upcoming games. `displayName`, `color` and `altColor` are optional and used on the live board and in celebrations.
- **Drivers**: Jolpica/Ergast driver ids (`alonso`, `max_verstappen`, …).
- **Players**: ESPN athlete ids.
- **Leagues**: competition keys to follow as a whole (all their live games, the round with the table, their news). Up to 25.

## Supported competitions

| Sport | Competitions |
| --- | --- |
| Football | LaLiga, LaLiga 2, Premier League, Championship, Serie A, Bundesliga, Ligue 1, Liga Portugal, Eredivisie, Belgian Pro League, Süper Lig, Scottish Premiership, MLS, Liga MX, Brasileirão, Liga Profesional (ARG), Saudi Pro League. Cups: Copa del Rey, Supercopa, FA Cup, Carabao Cup, Coppa Italia, DFB-Pokal, Coupe de France, Taça de Portugal, KNVB Beker, US Open Cup, Copa MX. International: Champions League, Europa League, Conference League, Libertadores, Sudamericana, Concacaf Champions Cup, Leagues Cup, Club World Cup. National teams: World Cup, UEFA qualifiers, Nations League, Euro, Euro qualifiers, Copa América, friendlies. |
| Basketball | NBA, WNBA, EuroLeague, EuroCup, FIBA national teams |
| American football | NFL |
| Hockey | NHL |
| Baseball | MLB |
| Motorsport | Formula 1 (pick drivers) |
| Tennis | ATP and WTA (pick players) |

The catalog lives in `server/catalog.js`. Adding an ESPN competition is usually one line.

## Settings screen

Tap the gear (bottom left), or open `http://<device-ip>:3000/#settings` from your phone. Changes apply immediately.

- **General**: language, name, time zone, clock, rotation, night mode, calendars, morning briefing, wake on motion, Spotify, backup, and a switch for every optional feature.
- **Teams**: pick a team from any competition list; "Follow this league" follows the whole competition.
- **Formula 1**, **Tennis**: pick drivers and players.
- **Markets**: search any symbol (stocks, ETFs, indices, crypto, FX, futures); reorder and remove, up to 12.
- **Notes**: optionally with a reminder time.
- **Kitchen**: paste a recipe link, reopen recent recipes, see and edit what Dash remembers.
- **Dates**: countdowns, one-off or yearly.

Everything is stored in `data/db.json`. `config.json` seeds it: when you change favourites, symbols or general settings there, the config wins on the next start. Notes are never touched.

## Spotify

Dash shows and controls what plays on your own Spotify devices; it isn't a speaker itself.

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) (free). API: Web API. Redirect URI, exactly: `http://127.0.0.1:3000/api/spotify/callback` (use your port).
2. Put its Client ID in `config.json` → `"spotify": { "clientId": "…" }` and restart Dash.
3. On the display itself, open Settings → General → Spotify → Connect and sign in once.

Spotify's 2026 rules for personal apps: the app owner needs Premium (and playback control needs Premium); up to 5 users per app, added under "User Management" in the Spotify dashboard; sign-in only works on the display, since Spotify only allows plain-`http` redirects to `127.0.0.1`. Development-mode apps also can't list the songs of other people's playlists (they still play) or an artist's official top tracks (Dash uses the best search hits instead). The sign-in token lives in `data/spotify.json` on this device, outside backups; "Disconnect" removes it.

## Backup and restore

Everything you set up lives in `data/db.json`: favourites, notes, shopping list, countdowns, recipes, memories, calendar links and on-screen settings.

- **Download**: Settings → General → Backup → Download backup (one JSON file; easiest from a phone at `http://<device-ip>:3000/#settings`).
- **Restore**: "Restore from a file…" shows the backup's date and contents before anything changes. A restore can move your setup to a new device.
- **Automatic copies**: one a day in `data/backups/` (the last 14 are kept), plus a copy before every restore (the last 10), listed under "Copies on this device".

The backup includes private things (calendar links, the guest Wi-Fi password, memories): keep it somewhere safe.

## Windows kiosk

1. Install Node with [nvm-windows](https://github.com/coreybutler/nvm-windows). In the project folder: `npm install`, copy and edit `config.json`, `npm run build`.
2. Optional: turn on Windows location services, then run `windows\edge-kiosk-policy.reg` (admin) so Edge shares location and allows the microphone and camera for Dash without prompts, and skips its first-run popups. These are machine-wide Edge policies.
3. Double-click `start.bat`. It builds if needed, keeps the machine awake on AC power, starts the server minimized (logs in `data\server.log`) and opens Edge in kiosk mode. It reopens Edge within a minute if it's closed. To leave for good, close the minimized "start.bat" window, then `Alt+F4` in Edge.
4. Auto-start at login: `powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1` (`-Remove` undoes it). For a hands-off device, enable automatic sign-in too (`netplwiz`).

## Demo mode

`npm run demo` (or `start.bat demo`) simulates live games for the first football, baseball and basketball team in your favourites, each against a real opponent, plus another live game for the Live panel. Buttons at the top (or keys `1`, `2`, …) make your team score, as does `curl -X POST localhost:3000/api/demo/score -H 'content-type: application/json' -d '{"team":"arsenal"}'`.
