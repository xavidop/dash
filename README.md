# Dash

An always-on ambient display in the spirit of a Google Nest Hub, built for a wall-mounted tablet or any screen running a browser in kiosk mode. It shows the time, weather, news and markets, your calendar and shopping list, follows your teams in every competition they play, takes over the screen when one of them is live, and, optionally, answers when you say "Hey Dash".

Everything is configured in one file, the language included (English, Spanish, French, Portuguese, German and Italian ship today; adding a language is one JSON file).

| | |
| --- | --- |
| ![Home with the Today strip](docs/screenshots/home.png) | ![Live football board](docs/screenshots/live-football.png) |
| ![Sports: one card per team, every competition](docs/screenshots/sports.png) | ![Goal celebration](docs/screenshots/celebration.png) |
| ![Markets with market news](docs/screenshots/markets.png) | ![Settings](docs/screenshots/settings.png) |
| ![Agenda from your calendars](docs/screenshots/agenda.png) | !["Hey Dash" voice assistant](docs/screenshots/assistant.png) |
| ![Cooking mode](docs/screenshots/cooking.png) | ![Shopping list](docs/screenshots/shopping.png) |
| ![Playoff bracket](docs/screenshots/bracket.png) | ![What to cook: daily recipe ideas](docs/screenshots/recipes.png) |

- **Home**: big clock and date, weather with an animated icon, high/low, rain chance, sunrise/sunset, 6-hour and 5-day forecasts (Open-Meteo).
- **Today strip** (on Home): what matters today at a glance:
  - official weather warnings and public holidays (today or tomorrow)
  - your teams playing today or live
  - note reminders due today and upcoming countdowns ("12 days to the trip")
  - rain in the next 12 hours, a high UV index, air quality and pollen
  - the cheapest electricity slot and the price right now (Spain)
  - the moon phase (on full, new and quarter moons) and your pinned note
- **Electricity price** (Spain): the regulated PVPC price for every hour, coloured cheap/average/expensive, with the best 2-hour slot and tomorrow's prices from about 20:15.
- **Reminders and countdowns**: give a note a time and it pops up full-screen then. Countdowns are dates (yearly or one-off) that appear in the Today strip as they approach.
- **Where to watch**: the channel next to your team's next match. Coverage depends on the source: EuroLeague and EuroCup list channels per country (e.g. Movistar+ in Spain); ESPN and MLB list only US channels, so those show only in the US.
- **Match day**: a toast 15 minutes before your team kicks off, and a **Preview** panel for your next match within 90 minutes (countdown, channel, table positions, starting line-ups once published, about an hour before; probable pitchers for MLB).
- **Round results**: on days a league plays, one panel per league your teams play in (football, NBA, NFL, NHL, MLB, EuroLeague/EuroCup) or that you follow, with that round's results, live games and the matches still to come. Your team's rows are highlighted. Leagues with no game today don't get a panel.
- **Postseason**: NBA, NFL, NHL and MLB playoff games are included, with the stage and the series on cards, round panels and the live board ("AL Championship Series · Game 5 · Series tied 2-2"). During the playoffs the round panel drops the regular-season table.
- **Playoff brackets**: a bracket panel for the knockout stage, with series wins (or scores and aggregates), winners highlighted and your team marked. It covers:
  - the NBA, NHL, NFL and MLB postseasons, split by conference or league
  - the Champions, Europa and Conference League knockouts, domestic cups (FA Cup, Copa del Rey, Coupe de France…) and national-team tournaments (World Cup, Euro, Copa América…)
  - EuroLeague (Play-In, Playoffs, Final Four) and EuroCup

  Brackets appear for competitions your teams play in or that you follow, and only while the knockouts are on: within 3 days of a game. Early rounds of big cups are dropped so the bracket fits the screen.
- **Followed leagues**: follow a whole league (Settings → Teams → pick a competition → "Follow this league"). Every live game in it shows in the Live panel and the ticker, its round panel adds the full table, and its stories join Sports news.
- **Rain radar**: an animated map of the last two hours of rain around you (RainViewer). Tap the weather on Home to open it; it also joins the rotation as a panel when rain is likely (or always, if you prefer).
- **Agenda**: your calendars (Google, iCloud, Outlook, any iCal link) for today and the coming days, plus Today chips for what's next. Paste the link in Settings → General → Calendars (or `calendar.urls` in `config.json`); the panel appears once a link is set.
- **Shopping list**: tap items off as they go in the basket, then "Clear ticked". Add items by voice or from your phone (see [API](#api-phone-and-automations)); the panel appears when the list has something on it.
- **Cooking mode**: a full-screen kitchen view of one recipe: ingredients to tick off, one big step at a time, and a timer button whenever a step mentions a time. Paste a recipe link in Settings → Kitchen (most recipe sites work), reopen one you cooked before, or say "Dash, let's make carbonara for two". With the assistant on, say "next", "back", "repeat" or "start the timer" while cooking: these work instantly, without calling Gemini, and Dash reads the step aloud.
- **What to cook**: six recipe ideas a day with photos (mains from different categories plus a dessert, or a breakfast in the morning), the same on every screen; "Shuffle" brings new ones. Tap one for its ingredients and steps, tap the ingredients you're missing to put them on the shopping list, and "Start cooking" opens it in cooking mode. Recipes come from TheMealDB (free, in English); with a Gemini key and the screen in another language, they're translated, with US measures converted to metric.
- **Morning briefing**: "Dash, good morning" gives a short spoken summary: weather and warnings, today's calendar and reminders, your teams, bins and a headline. It can also play by itself at a set time on chosen days (Settings → General → Morning briefing).
- **Music (Spotify)**: what's playing on any of your Spotify devices (phone, speaker, computer, TV): a mini player in the corner of every screen and a Music panel with artwork, progress, play/pause/skip, volume and a speaker picker. When nothing is playing (or with "Browse"), the panel lets you start something: pick a speaker, then one of your playlists or anything from search (songs, artists, albums, playlists, podcasts). Artists, albums, playlists and podcasts open a page: play it, shuffle it, or start from one song; an artist's page has their popular songs and albums, a podcast's its latest episodes. While a song plays, its time-synced lyrics (LRCLIB) take the artwork's place and follow along; the Lyrics button switches back. The music-note button (bottom left) opens it from any screen. With the assistant: "play some jazz", "play my Discover Weekly on the kitchen speaker", "next song", "louder"; Dash lowers the music while it talks. Optional; see [Spotify](#spotify).
- **Bin days**: chips in the Today strip for collection days ("Recycling goes out tonight").
- **"Hey Dash" voice assistant** (optional, Gemini Live): say "Dash" or tap the microphone and ask anything. It answers out loud, searches Google for current facts, knows your teams, calendar and weather, and can add to the shopping list, save notes and reminders, set up timers and alarms ("10 minutes for the rice", "wake me at 7:30", "add 5 minutes", "how long is left?", "cancel the oven one"), cook with you, and remember things ("remember that the plumber is Juan, 600 123 456"; later, "what's the plumber's number?"). The conversation shows on screen as a chat, with a receipt for everything it changed. Needs a Gemini API key.
- **Guest Wi-Fi**: a button that shows a QR code your guests' phones can scan to join (off by default).
- **Kitchen timers**: the hourglass button (bottom left) opens presets and a custom duration with a label. Running timers count down in a corner of every screen; a finished one rings full-screen until tapped. Timers live on the server, so you can start one from your phone.
- **News**: a hero story with a slow Ken Burns pan, plus five headlines from RSS feeds, deduplicated. Default feeds follow your language and, where Dash knows good ones, your country (see [Languages](#languages)).
- **Sports news**: stories about the teams, drivers and players you follow (ESPN plus Google News, in your language).
- **Sports**: one card per team. A card covers every competition the team plays (domestic league, cups, continental, national-team tournaments), cycling through them with tabs. There are also cards for Formula 1 (next GP, your drivers, championship) and tennis (your players' ranking and live/next/last match).
- **Markets**: stocks, indices, crypto and FX with intraday sparklines, plus a market-news column (per language and country, e.g. Expansión in Spanish, Les Echos in French, Handelsblatt in German, Yahoo Finance headlines for your symbols in English).
- **Quote of the day.**
- **Notes**: sticky notes, added on screen or from your phone.
- **Live**: other live games in the competitions you choose, plus a ticker at the bottom of every panel.
- **Live takeover**: when one of your favourites is playing, a full-screen board replaces the rotation. There are boards for football (scorers, cards, timeline), baseball (diamond, count, linescore, matchup), basketball, American football and hockey (period scores), tennis (sets) and F1 (running order). When your team scores you get a full-screen celebration; when a rival scores, a small toast.
- **Night mode**: a dim clock-only view during configurable hours.
- **Wake on motion** (optional, off by default): the device's camera notices when someone walks into the room. The screen wakes from night mode and brightens, and it dims after the room has been empty for a while (Settings → General → Wake on motion). Everything happens in the browser: Dash compares tiny grey frames (64×48 pixels) twice a second and keeps only "something moved". No image is stored, recognised or sent anywhere.

Panels rotate every 60 s with swipe navigation. Rotation pauses for 2 minutes after a touch, and optional panels only appear when they have content. What's happening now comes right after Home: other live games, today's match previews and the Music panel. The page dots are grouped by section (Home, Now, Your day, News, Sports, Markets): one dot per section, and the current section opens up into a dash per page.

## Quick start

Requires Node.js 22+ (developed on Node 26). With nvm: `nvm install && nvm use`. On Windows, use [nvm-windows](https://github.com/coreybutler/nvm-windows): `nvm install latest`, then `nvm use latest`.

```bash
npm install
cp config.example.json config.json   # then edit it
echo "GEMINI_API_KEY=your-key" > .env  # optional, only for the voice assistant
npm run build
npm start                            # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm start` | Runs the server (serves the built frontend and the API) |
| `npm run demo` | Builds, then simulates live games for your favourites (see below) |
| `npm run dev` / `npm run dev:demo` | Server with auto-reload, plus Vite at http://localhost:5173 |
| `npm run typecheck` | Type-checks the frontend |

Environment: `PORT`, `DASH_CONFIG=/path/to/config.json`, `DASH_DATA_DIR=/path/to/data`, `DASH_DEMO=1`, and `GEMINI_API_KEY` for the voice assistant. Variables can also go in a `.env` file in the project folder (gitignored); real environment variables win.

## Configuration (`config.json`)

`config.json` is personal and gitignored. Without it, Dash runs from `config.example.json`.

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
| `favorites` | Your teams, F1 drivers and tennis players (see below) |
| `liveLeagues` | Competitions whose live games (any teams) feed the Live panel and ticker, e.g. `{ "provider": "espn", "league": "eng.1" }` |
| `finance` | `{ "symbols": ["^GSPC", "AAPL", "BTC-USD", "EURUSD=X"], "refreshMinutes": 5, "newsSources": [] }`, using Yahoo Finance symbols. `newsSources` (RSS) overrides the default market news for your language. |
| `quote` | `{ "enabled": true }` |
| `sportsNews` | `{ "enabled": true, "perTeam": 4 }` |
| `features` | Switch each optional feature on or off: `alerts`, `airQuality`, `uv`, `holidays`, `moon`, `electricity`, `reminders`, `countdowns`, `whereToWatch`, `preMatch` (kickoff toast and Preview panel), `matchday` (round results), `brackets` (playoff brackets), `radar`, `calendar`, `cooking`, `spotify`, `assistant`, `motion` (wake on motion), `wifiQr`. All are on except `wifiQr`, `assistant` and `motion`. They can also be toggled in Settings → General. |
| `alerts` | `{ "areas": [] }`: official weather warnings (MeteoAlarm in Europe, NWS in the US) are matched to your location by area name. To pin exact zones, list their MeteoAlarm EMMA_ID codes or names. |
| `electricity` | `{ "region": "peninsula" }`: PVPC price zone (`peninsula`, `canarias`, `baleares`, `ceuta`, `melilla`). Only fetched when the display is in Spain. |
| `countdowns` | `{ "withinDays": 30 }`: how far ahead countdowns show in the Today strip |
| `radar` | `{ "showWhen": "rain", "tiles": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "attribution": "© OpenStreetMap" }`: `showWhen` is `rain` (the radar panel joins the rotation only when rain is likely) or `always`. `tiles` and `attribution` set the base map; for heavy use, point them to your own tile server or another provider. |
| `calendar` | `{ "urls": [], "days": 14 }`: iCal links (also editable in Settings → General → Calendars), as strings or `{ "name", "url", "color" }`. Google Calendar: Settings → your calendar → "Secret address in iCal format". iCloud: share as a public calendar. `webcal://` links work. These links are private: keep them only in `config.json`. |
| `cooking` | `{ "model": "gemini-3.8-flash" }`: the Gemini model that reads recipe pages without a recipe card and translates the "What to cook" ideas (only with `GEMINI_API_KEY`). Turn cooking mode and the ideas off with `features.cooking`. |
| `briefing` | `{ "time": null, "weekdays": [1, 2, 3, 4, 5, 6, 0] }`: when the assistant says good morning by itself (`"07:30"`; `null` = only when asked). Weekdays: 0 = Sunday. Also in Settings → General. |
| `bins` | `[{ "name": "Recycling", "weekdays": [2, 5], "evening": true }]`: collection days for the Today strip and the briefing. `evening: true` reminds you the evening before (when the bins go out), otherwise on the day. |
| `spotify` | `{ "clientId": "" }`: the Client ID of your own Spotify app (or `SPOTIFY_CLIENT_ID` in the environment). See [Spotify](#spotify). |
| `assistant` | `{ "model": "gemini-3.8-live", "voice": "Kore", "wakeWords": ["dash"], "idleSeconds": 8, "allowRemote": false }`. See [Voice assistant](#voice-assistant). |
| `motion` | `{ "dimAfterMinutes": 10, "sensitivity": "medium" }`: wake on motion (turn it on with `features.motion`). `dimAfterMinutes` is how long the room must be empty before the screen dims (`0` = never dim, only wake); `sensitivity` is `low`, `medium` or `high`. Also in Settings → General. |
| `wifi` | `{ "ssid": "", "password": "", "security": "WPA", "hidden": false }`: the guest network for the QR code (`security`: `WPA`, `WEP` or `nopass`). Turn on `features.wifiQr` to show the button. |
| `watchdog` | `{ "maxMemoryMB": 700, "dailyReload": "04:00" }`: restart the server above this memory, and reload the page daily at this time (`null` to disable) |

### Favourites

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

- **Teams**:
  - `league` is any key from the table below. It's only where Dash looks the team up by `name`; IDs are never hardcoded.
  - Dash then finds every competition the team plays in. A football club gets its domestic league, cups and continental competitions; a national team gets its tournaments, qualifiers and friendlies. It keeps the ones with recent or upcoming games.
  - `displayName`, `color` and `altColor` are optional and are used on the live board and in celebrations.
- **Drivers**: Jolpica/Ergast driver ids (`alonso`, `max_verstappen`, …).
- **Players**: ESPN athlete ids.
- **Leagues** (optional): competition keys from the table below to follow as a whole: all their live games, the round with the table, and their news. Up to 25.

### Settings screen

Tap the gear (bottom left), or open `http://<device-ip>:3000/#settings` from your phone. Every change applies immediately, with no restart:

- **General**: language, your name, time zone, 24-hour clock, rotation interval, night mode and its hours, and your calendars (paste iCal links; only the host is shown afterwards, never the secret part).
- **Teams**: pick a team from any competition list; Dash follows it everywhere it plays. Open a competition and switch on "Follow this league" to follow the whole league.
- **Formula 1** and **Tennis**: pick drivers and players.
- **Markets**: search any symbol (stocks on any exchange, ETFs, indices, crypto, FX, futures) or add one from the suggestions. You can reorder and remove them, up to 12.
- **Notes**: optionally with a reminder time.
- **Kitchen**: paste a recipe link to start cooking mode, reopen recent recipes, and see (or add and delete) what Dash remembers.
- **Dates**: countdowns, one-off or yearly.
- **General → Backup**: download a backup file, restore one, or go back to one of the copies Dash keeps by itself (see [Backup and restore](#backup-and-restore)).
- **General → Features**: a switch for every optional feature (including the voice assistant, which says there if `GEMINI_API_KEY` is missing), plus when to show the rain radar, the electricity zone, the countdown look-ahead and the guest Wi-Fi details.

Everything is stored in a local JSON database, `data/db.json`. `config.json` seeds it. When you change favourites, symbols or general settings in `config.json`, the config wins on the next start. Edits made on screen persist until then. Notes are never touched.

### Supported competitions

| Sport | Competitions |
| --- | --- |
| Football (soccer) | LaLiga, LaLiga 2, Premier League, Championship, Serie A, Bundesliga, Ligue 1, Liga Portugal, Eredivisie, Belgian Pro League, Süper Lig, Scottish Premiership, MLS, Liga MX, Brasileirão, Liga Profesional (ARG) and Saudi Pro League. Cups: Copa del Rey, Supercopa, FA Cup, Carabao Cup, Coppa Italia, DFB-Pokal, Coupe de France, Taça de Portugal, KNVB Beker, US Open Cup, Copa MX. International: Champions League, Europa League, Conference League, Libertadores, Sudamericana, Concacaf Champions Cup, Leagues Cup, Club World Cup. National teams: World Cup, UEFA qualifiers, Nations League, Euro, Euro qualifiers, Copa América, friendlies. |
| Basketball | NBA, WNBA, EuroLeague, EuroCup, FIBA national teams |
| American football | NFL |
| Hockey | NHL |
| Baseball | MLB |
| Motorsport | Formula 1 (pick drivers) |
| Tennis | ATP and WTA (pick players) |

The catalog lives in `server/catalog.js`. Adding an ESPN competition is usually one line.

## Voice assistant

"Hey Dash" runs on Google's Gemini Live API. To turn it on:

1. Get an API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Put it in a `.env` file next to `config.json` (gitignored), or in the environment: `GEMINI_API_KEY=your-key`.
3. Switch on Settings → General → Voice assistant (or `features.assistant` in `config.json`).

Say "Dash" (or "Hey Dash, …" in one breath), or tap the microphone button (bottom left). A small blue dot on the button means it's listening for the wake word.

What you can ask:

- **Anything**: it answers out loud in one or two sentences and uses Google Search for current facts (news, scores, opening hours, the weather elsewhere).
- **About your day**: it already knows the weather, your teams' last and next games, your calendar, the shopping list and running timers, so "when do Arsenal play?" doesn't need a search.
- **Shopping list**: "add milk and eggs", "what's on the list?", "remove the coffee".
- **Notes and reminders**: "note: call the plumber", "remind me tomorrow at 10 to call the bank".
- **Timers and alarms**: "10 minutes for the rice and 40 for the oven", "wake me at 7:30", "add 5 minutes to the rice", "how long is left?", "cancel the oven one" (or "cancel them all").
- **Cooking**: "let's make carbonara for two" (Dash writes the recipe and opens cooking mode), "let's make the lasagna again" (from your recent recipes), "how much butter?", "next step", "start the timer". In cooking mode, short commands ("next", "back", "repeat", "start the timer", "stop cooking", and their equivalents in each language) are handled on the device without Gemini.
- **Memory**: "remember that the plumber is Juan, 600 123 456", "the Wi-Fi at grandma's is PATATA2024", then later "what's the plumber's number?". "Forget the plumber" deletes it. Facts are stored in the local database (Settings → Kitchen lists them) and sent to Gemini as context in each conversation, so don't store anything you wouldn't say to it.
- **Morning briefing**: "good morning", "what's today?", or automatically at the time set in Settings → General.

The conversation shows as a chat at the bottom of the screen: your words on the right, Dash's on the left, and a green receipt for everything it changed ("✓ Added to the shopping list: milk, eggs"). Dash replies in the language you speak, and keeps listening for a follow-up. Tap the card while it talks to cut it short; tap ✕ or say "thanks" to close.

**It isn't always connected.** Gemini is only on the line during a conversation:

| State | What runs | Gemini cost |
| --- | --- | --- |
| Waiting for "Dash" | The browser's speech recognition | none |
| Talking | A live Gemini session (microphone up, voice down) | per minute |
| Closed | After `idleSeconds` (8 s) of silence once Dash has finished, on "thanks" or ✕, or after 5 minutes at most | none |

**Costs** (Google's prices for `gemini-3.8-live`, October 2026; check [the pricing page](https://ai.google.dev/gemini-api/docs/pricing) for current ones):

- **Free tier**: free of charge, with rate limits; Google may use free-tier data to improve its products.
- **Paid tier**: audio in about $0.005 per minute, audio out about $0.018 per minute. Google Search grounding includes 5,000 searches a month, then $14 per 1,000.
- **In practice**: a typical question (about 20 s of listening and 8 s of answer) costs around half a cent, so 20 questions a day is roughly $3 a month. The microphone isn't sent while Dash speaks, so that time isn't billed as input.

**Privacy and security:**

- **The key stays on the server.** For each conversation the server mints a single-use token valid for 30 minutes, with the model, voice, instructions and tools locked in; Gemini ignores any other setup sent with it. Only the display itself (`localhost`) may ask for a token unless `assistant.allowRemote` is set, so devices on your Wi-Fi can't spend your key.
- **Audio goes from the browser straight to Gemini** during a conversation. Tool calls (shopping list, notes, timers) come back to the browser and run on Dash's server.
- **Wake word**: Dash uses the browser's built-in speech recognition (Web Speech API). In Edge and Chrome that recognition runs on the browser vendor's online speech service, so while Dash is waiting for "Dash", what the microphone hears is processed by that service (not by Gemini, and not stored by Dash). The last 2.5 s of microphone audio are also kept in memory on the device, so "Hey Dash, what's the weather?" said in one breath reaches Gemini whole. Sound-alikes such as "das" only count after "hey", "oye" or "ok", since they're common words.
- Firefox has no speech recognition: there, use the microphone button.

**Settings** (`config.json` → `assistant`): `model`, `voice` (any Gemini voice, e.g. `Kore`, `Puck`, `Charon`), `wakeWords`, `idleSeconds` and `allowRemote`.

**Kiosk**: `windows/edge-kiosk-policy.reg` allows the microphone for `http://localhost:3000` without a prompt. In a normal browser, allow the microphone when asked.

## Spotify

Dash shows and controls what plays on your own Spotify devices; it isn't a speaker itself.

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) (free). Under "Which API/SDKs": Web API. Add this Redirect URI exactly: `http://127.0.0.1:3000/api/spotify/callback` (use your port).
2. Put its Client ID in `config.json` → `"spotify": { "clientId": "…" }` and restart Dash.
3. On the display itself, open Settings → General → Spotify → Connect Spotify and sign in once. Dash stays connected.

Things Spotify requires (2026 rules for personal apps):

- **Premium**: the owner of the Spotify app needs an active Premium subscription, and controlling playback needs Premium.
- **Up to 5 users** per app; add other household members under "User Management" in the Spotify dashboard.
- **Sign in on the display**: Spotify only allows plain-`http` sign-in redirects to `127.0.0.1`, so connecting from a phone doesn't work. Once connected, every screen and phone sees the music.
- The sign-in token is kept in `data/spotify.json` on this device (not in backups). "Disconnect" in Settings removes it.

Music needs a device that's on: if nothing is active, "play …" wakes the last one Spotify knows about.

## Backup and restore

Everything you set up on Dash lives in `data/db.json`: favourites, notes, the shopping list, countdowns, recipes, what Dash remembers, calendar links and on-screen settings.

- **Download**: Settings → General → Backup → Download backup gives you one JSON file. From a phone, open `http://<device-ip>:3000/#settings`, which is the easiest way to keep the file somewhere else.
- **Restore**: "Restore from a file…" shows the backup's date and what's in it ("Favourites: 5 · Notes: 12 · …") before anything changes. A restore can also move your setup to a new device.
- **Automatic copies**: Dash saves a copy a day in `data/backups/` (the last 14 are kept), and a copy of the current data before every restore (the last 10), so a restore can be undone. They're listed under "Copies on this device".
- Restoring keeps this device's link to `config.json`: if you later edit favourites or settings there, those edits still win on the next start, as usual.

The backup includes private things (calendar links, the guest Wi-Fi password, memories): keep the file somewhere safe.

## API (phone and automations)

Everything on screen can also be driven over HTTP from any device on your network (e.g. an iOS Shortcut or Home Assistant). Changes appear on the display immediately.

| Endpoint | What it does |
| --- | --- |
| `POST /api/shopping` `{ "items": ["milk", "eggs"] }` | Add to the shopping list (duplicates are skipped). `GET`, `PATCH /api/shopping/:id` `{ "done": true }`, `DELETE /api/shopping/:id`, `POST /api/shopping/clear-done` |
| `POST /api/notes` `{ "text": "…", "remindAt": "2026-10-19T10:00:00+02:00" }` | Add a note, optionally with a reminder. `GET`, `PATCH`, `DELETE /api/notes/:id` |
| `POST /api/timers` `{ "seconds": 600, "label": "pasta" }` | Start a timer. `PATCH /api/timers/:id` `{ "addSeconds": 60 }`, `DELETE /api/timers/:id` |
| `POST /api/countdowns` `{ "title": "Trip", "date": "2026-12-01", "yearly": false }` | Add a countdown. `GET`, `DELETE /api/countdowns/:id` |
| `POST /api/cooking` `{ "url": "https://…" }` | Start cooking mode from a recipe link (or `{ "id" }` from the history, `{ "idea" }` from What to cook). `GET /api/recipes/ideas/:id`, `POST /api/recipes/ideas/shuffle`; `PATCH /api/cooking` `{ "go": "next" }`, `POST /api/cooking/timer`, `DELETE /api/cooking`; `GET /api/recipes` |
| `POST /api/memories` `{ "text": "…" }` | Add something Dash remembers. `GET`, `DELETE /api/memories/:id` |
| `POST /api/spotify/play` `{ "query": "jazz", "device": "kitchen" }` | Play something (or `{ "uri", "deviceId" }` for an exact item). `GET /api/spotify/playlists`, `GET /api/spotify/search?q=`. `POST /api/spotify/control` `{ "action": "pause" }` (`play`, `next`, `previous`, `volume`, `volume_up`, `volume_down`, `shuffle`, `transfer`), `GET /api/spotify/devices` |
| `GET /api/backup` | Download a backup. `POST /api/backup/restore` with the file as the body (or `{ "name" }` of a copy from `GET /api/backups`) |
| `GET /api/health` | Uptime, memory and the age of every data section |

The API has no authentication: keep Dash on a trusted network.

## Languages

Every user-facing string, server-generated text included (match statuses, weather, rounds, competition names), lives in `locales/<lang>.json`. Bundled quotes live in `locales/quotes/<lang>.json`.

When `news.sources` is empty, Dash also picks feeds for your country where it knows good ones (for example Spanish in Mexico, Argentina, Colombia, Chile, Peru or the US; English in the UK, US, Canada, Australia, Ireland, India, New Zealand or South Africa; French in Canada, Belgium or Switzerland; German in Austria or Switzerland; Italian in Switzerland; Portuguese in Portugal), and falls back to the language defaults below.

| Language | News (default feeds) | Market news | Notes |
| --- | --- | --- | --- |
| English (`en`) | BBC, The Guardian, NPR | Yahoo Finance, Google News | ZenQuotes for the daily quote |
| Spanish (`es`) | El País, 20minutos, El Mundo, Europa Press | Expansión, Google News | |
| French (`fr`) | Le Monde, franceinfo, France 24, Le Figaro | Les Echos, Google News | |
| Portuguese (`pt`, Brazil) | g1, BBC News Brasil, Agência Brasil | InfoMoney, Google News | |
| German (`de`) | tagesschau, DER SPIEGEL, ZEIT ONLINE, DW | Handelsblatt, tagesschau, Google News | |
| Italian (`it`) | RaiNews, ANSA, Agi, Il Sole 24 Ore | Il Sole 24 Ore, Google News | |

What depends on the source rather than on Dash:

- **Team and player names** come from ESPN, which localizes only Spanish and Brazilian Portuguese. In French, German and Italian they stay in English ("Spain", "Bayern Munich"); your own display names in Settings are always used as typed.
- **Sports news**: ESPN writes news only in English, Spanish and Portuguese. The other languages use Google News alone, so stories have no images.
- **Weather warnings** come in the languages the national service publishes; when yours isn't one of them, they show in English.
- **Public holidays** use the local name when it's in your language and the English name otherwise.

To add a language:

1. Copy `locales/en.json` to `locales/<lang>.json` and translate it. Missing keys fall back to English.
2. Optionally add `locales/quotes/<lang>.json`.
3. Set `"language": "<lang>"` in `config.json`.
4. If the language needs special ordinals or table positions, check `ord()` and `rank()` in `server/lib/i18n.js` and `web/src/i18n.ts`.

## Demo mode

`npm run demo` (or `start.bat demo` on Windows) simulates live games for the first football, baseball and basketball team in your favourites, each against a real opponent from the same competition. It also adds another live game for the Live panel.

Buttons at the top make your team score; keys `1`, `2`, … do the same. You can also use the API:

```bash
curl -X POST localhost:3000/api/demo/score -H 'content-type: application/json' -d '{"team":"arsenal"}'
```

## Windows kiosk setup

1. Install Node with nvm-windows. In the project folder run `npm install`, copy and edit `config.json`, then run `npm run build`.
2. **Location, microphone and camera** (optional): turn on Windows location services. Then run `windows\edge-kiosk-policy.reg` (needs admin) so Edge shares location and allows the microphone and camera (for wake on motion) for Dash without a prompt, and skips its first-run and restore popups. These are machine-wide Edge policies.
3. **Test it**: double-click `start.bat`. It builds if needed, keeps the screen and machine awake on AC power, starts the server minimized (logs go to `data\server.log`), then opens:
   ```
   msedge --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0
   ```
   To exit, press `Alt+F4`.
4. **Auto-start at login**: run `powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1`; `-Remove` undoes it. For a hands-off device, enable automatic sign-in too (`netplwiz`).

## Reliability (self-healing)

Dash is meant to run for weeks without anyone touching it:

- **Sources**: a source that starts refusing requests (HTTP 403/429, usually rate limiting) is paused as a whole for a minute, doubling up to 15 minutes while it continues, and is reported once in the log and under `pausedSources` in `/api/health`. Failing leagues are logged when they start failing and when they recover, not on every retry.
- **Server**: `npm start` runs `server/supervise.js`, which restarts the server if it crashes or exits, with backoff for crash loops. The server exits on an uncaught exception, or when it uses more than `watchdog.maxMemoryMB`, so the supervisor brings it back clean. `GET /api/health` reports uptime, memory and the age of every data section.
- **Page**:
  - reconnects if the live stream goes quiet for 75 s
  - reloads after an outage longer than 2 minutes
  - reloads when a new build is deployed (`npm run build` while it's running)
  - reloads once a day at `watchdog.dailyReload`, but never during a live game or while someone is using it
- **Kiosk**: `start.bat` reopens Edge within a minute if it's closed or crashes. To leave kiosk mode for good, close the minimized "start.bat" window first, then press `Alt+F4` in Edge.

## Development

```bash
npm run dev:demo      # server (auto-reload) + Vite with simulated live games
npm test              # unit tests (node:test): feed parsing, i18n (every language), catalog, DB, backup and restore, timers, alerts, calendar, match day, followed leagues, recipes and cooking, Spotify, assistant tools and memory
npm run typecheck && npm run build
```

CI runs the same steps on Node 22 and 24 (`.github/workflows/ci.yml`). See [CONTRIBUTING.md](CONTRIBUTING.md) for adding a language, a competition or a data source.

## Architecture

```
config.example.json       template (copy to config.json)
locales/                  UI + data strings per language, bundled quotes
server/
  supervise.js            keeps the server running (restart with backoff)
  index.js                Express app, SSE hub (/api/stream), refresh jobs, REST API, self-healing
  catalog.js              competitions + candidate competitions for a team
  lib/                    config, i18n, disk-backed store (data/cache.json), JSON DB (data/db.json)
  providers/
    location.js           device → IP → config location
    weather.js            Open-Meteo
    news.js               RSS (HTML stripping, near-duplicate removal)
    sportsNews.js         ESPN news + Google News per favourite
    finance.js            Yahoo Finance chart API
    quote.js              ZenQuotes (en) + bundled lists
    alerts.js             MeteoAlarm / NWS weather warnings
    airQuality.js         Open-Meteo air quality + pollen
    electricity.js        REE PVPC hourly price (Spain)
    holidays.js           Nager.Date public holidays (national + region)
    radar.js              RainViewer radar frames
    calendar.js           iCal feeds → events (recurrences, time zones)
    spotify.js            Spotify sign-in (PKCE), now playing, controls, search and play, ducking
    recipe.js             recipe links → steps (schema.org Recipe cards, Gemini fallback), step times
    sports/
      provider.js         SportsProvider interface + normalized Game shape
      espn.js             football, basketball, NFL, NHL: teams, schedules, scoreboards, standings
      mlb.js              MLB Stats API (schedule, standings, live feed)
      euroleague.js       official EuroLeague/EuroCup feeds
      tennis.js, f1.js    ESPN tennis; Jolpica + ESPN for F1
      demo.js             simulated games for npm run demo
  services/
    favorites.js          resolves favourites, discovers their competitions, builds cards
    live.js               adaptive live poller, score-change detection → celebrations
    timers.js             kitchen timers (shared by every screen and phone)
    matchday.js           match previews (line-ups) and round results per league
    recipeIdeas.js        "What to cook": daily recipe ideas (TheMealDB), optional Gemini translation
    brackets.js           playoff and knockout brackets (ESPN, MLB, EuroLeague), only while knockouts are on
    assistant.js          Gemini Live: ephemeral tokens, session setup, tool calls, briefing context
    cooking.js            cooking mode state (current recipe and step), recipe history
web/                      Vite + vanilla TypeScript
  src/main.ts             rotation, swipe, live takeover, peek strip, ticker, night mode, sky
  src/panels/*            Home + Today strip, Agenda, News, Sports news, Sports, Preview, Round results, Playoff bracket, What to cook, Markets, Electricity, Rain radar, Quote, Notes, Shopping list, Live
  src/live/*              live boards and celebrations
  src/settings.ts         Settings screen
  src/timers.ts           timers UI, countdown pills, alarm (Web Audio)
  src/extras.ts           note reminders (full-screen) and the guest Wi-Fi QR
  src/assistant.ts        wake word, microphone and playback, Gemini Live session, cooking voice commands, briefing schedule
  src/cooking.ts          cooking mode screen
  src/panels/music.ts     Spotify mini player and Music panel
  src/motion.ts           wake on motion (camera frame differences, dim overlay)
tests/                    node:test unit tests
```

- **Data flow**: providers produce normalized data, which goes into the store. The store persists to disk and pushes Server-Sent Events. The browser doesn't call third-party data APIs itself; it only loads images and map tiles, reports its own location, checks RainViewer's coverage map once, and (with the assistant on) talks to Gemini.
- **Resilience**: a failed refresh keeps the last data and shows a subtle "updated X min ago". On restart the cache is restored from disk, and the browser also keeps a copy, so the screen paints immediately.
- **Live polling**: each competition is polled on its own schedule: about every 20 s while it has a live game. When nothing is on, it sleeps until 10 min before its next known kickoff or its next match day from the league calendar (at most 6 h), so a cup with no game for weeks costs almost nothing. Only the competitions your teams play in (and leagues you follow) are polled.
- **Being a good citizen with free APIs**: finished past days are never downloaded twice, days without games are skipped (league calendar), round panels reuse the live poller's scoreboard for today, team cards are rebuilt only around games (otherwise reused for up to 2 h), requests to ESPN are spaced at least 0.7 s apart, identical simultaneous requests are shared, and a restart reuses cached data that's still fresh. `/api/health` shows requests per source over the last hour.

## Data sources (free, no API keys, except the optional voice assistant and Spotify)

| Data | Source |
| --- | --- |
| Weather | Open-Meteo |
| News | RSS (configurable; defaults per language and country) |
| Football, NBA/WNBA, FIBA, NFL, NHL, tennis | ESPN public site API (`site.api.espn.com`). Live data comes from the default feed because the localized one can lag; names are localized from cached team lists. |
| MLB | MLB Stats API (`statsapi.mlb.com`) |
| EuroLeague / EuroCup | Official EuroLeague feeds |
| Formula 1 | Jolpica (Ergast successor) + ESPN |
| Sports news | ESPN news + Google News RSS search |
| Markets | Yahoo Finance chart endpoint |
| Quote of the day | ZenQuotes (English), bundled lists otherwise |
| Weather warnings | MeteoAlarm (EUMETNET: AEMET, Met Office, DWD, …), US National Weather Service |
| Air quality & pollen | Open-Meteo Air Quality API |
| UV index | Open-Meteo |
| Electricity price (Spain) | Red Eléctrica (REE) `apidatos.ree.es`, PVPC |
| Public holidays | Nager.Date |
| Line-ups, round results | ESPN summary and scoreboard; MLB Stats API for probable pitchers |
| Rain radar | RainViewer (`api.rainviewer.com`), base map from OpenStreetMap |
| Calendar | Your iCal links (parsed with `ical.js`) |
| Song lyrics | LRCLIB (`lrclib.net`, free, no key) |
| Recipes | The recipe page's schema.org Recipe card; Gemini (`gemini-3.8-flash`) for pages without one. Recipe ideas: TheMealDB (`themealdb.com`, free test key) |
| Music | Spotify Web API, with your own Spotify app (Premium) |
| Voice assistant | Google Gemini Live API (`gemini-3.8-live`), with Google Search grounding; needs `GEMINI_API_KEY` |
| Guest Wi-Fi QR | generated locally (`qrcode` package) |
| Location | ipwho.is / ip-api.com, BigDataCloud reverse geocoding |

These are public but unofficial endpoints, used here for personal, non-commercial display. Their formats can change.

**Known gaps:**

- Spain's ACB has no free source with fixtures, so Spanish clubs are followed through the EuroLeague or EuroCup.
- Where RainViewer has no radar coverage (much of Africa, South America and Asia), the radar hides itself instead of showing an empty map.
- RainViewer's free tier serves only the past two hours of radar (no forecast frames), at up to zoom 7, so the radar looks back but not ahead.
- The default base map uses OpenStreetMap's tile servers, whose policy allows light use like one home display. For anything heavier, set `radar.tiles` to another provider.
- The voice assistant's wake word depends on the browser's speech recognition: it needs internet, isn't available in Firefox, and an English word like "Dash" can be misheard by a recognizer set to another language. The microphone button always works.
- The F1 live running order and in-game EuroLeague states were built from the documented formats but not yet seen during a live session.

## License

[MIT](LICENSE)
