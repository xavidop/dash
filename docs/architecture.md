# Architecture

```
config.example.json       template (copy to config.json)
locales/                  UI + data strings per language, bundled quotes
server/
  supervise.js            keeps the server running (restart with backoff)
  index.js                Express app, SSE hub (/api/stream), refresh jobs, REST API, self-healing
  catalog.js              competitions + candidate competitions for a team
  lib/                    config, i18n, disk-backed store (data/cache.json), JSON DB (data/db.json), HTTP (rate-limit pauses)
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
    holidays.js           Nager.Date public holidays
    radar.js              RainViewer radar frames
    calendar.js           iCal feeds → events (recurrences, time zones)
    spotify.js            Spotify sign-in (PKCE), now playing, controls, search, pages, play
    lyrics.js             LRCLIB synced lyrics
    recipe.js             recipe links → steps (schema.org Recipe cards, Gemini fallback)
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
    brackets.js           playoff and knockout brackets, only while knockouts are on
    recipeIdeas.js        "What to cook": daily recipe ideas (TheMealDB), optional Gemini translation
    assistant.js          Gemini Live: ephemeral tokens, session setup, tool calls, briefing context
    cooking.js            cooking mode state (current recipe and step), recipe history
web/                      Vite + vanilla TypeScript
  src/main.ts             rotation, swipe, grouped page dots, live takeover, ticker, night mode, sky
  src/panels/*            Home + Today strip, Agenda, News, Sports news, Sports, Preview, Round results, Playoff bracket, What to cook, Music, Markets, Electricity, Rain radar, Quote, Notes, Shopping list, Live
  src/live/*              live boards and celebrations
  src/settings.ts         Settings screen
  src/timers.ts           timers UI, countdown pills, alarm (Web Audio)
  src/extras.ts           note reminders (full-screen) and the guest Wi-Fi QR
  src/assistant.ts        wake word, microphone and playback, Gemini Live session, cooking voice commands
  src/cooking.ts          cooking mode screen
  src/motion.ts           wake on motion (camera frame differences, dim overlay)
tests/                    node:test unit tests
```

- **Data flow**: providers produce normalized data, which goes into the store. The store persists to disk and pushes Server-Sent Events. The browser doesn't call third-party data APIs itself; it only loads images and map tiles, reports its own location, and (with the assistant on) talks to Gemini.
- **Resilience**: a failed refresh keeps the last data and shows a subtle "updated X min ago". On restart the cache is restored from disk, and the browser keeps a copy too, so the screen paints immediately.
- **Live polling**: each competition is polled on its own schedule: about every 20 s while it has a live game. When nothing is on, it sleeps until 10 min before its next known kickoff or its next match day from the league calendar (at most 6 h). A game past its kickoff but not yet reported live keeps the league awake. Only the competitions your teams play in, and leagues you follow, are polled.
- **Being a good citizen with free APIs**: finished days are never downloaded twice, days without games are skipped, round panels reuse the live poller's scoreboard, team cards are rebuilt only around games, requests to ESPN are spaced at least 0.7 s apart, identical simultaneous requests are shared, and a restart reuses cached data that's still fresh. `/api/health` shows requests per source over the last hour.

## Reliability

Dash is meant to run for weeks untouched.

- **Sources**: one that starts refusing requests (HTTP 403/429) is paused as a whole for a minute, doubling up to 15 minutes, and reported once in the log and under `pausedSources` in `/api/health`. Failing leagues are logged when they start failing and when they recover.
- **Server**: `npm start` runs `server/supervise.js`, which restarts the server if it crashes, with backoff for crash loops. The server exits on an uncaught exception or above `watchdog.maxMemoryMB`, so the supervisor brings it back clean.
- **Page**: reconnects if the live stream goes quiet for 75 s, reloads after an outage longer than 2 minutes or when a new build is deployed, and reloads daily at `watchdog.dailyReload`, never during a live game or while someone is using it.
- **Kiosk**: `start.bat` reopens Edge within a minute if it's closed or crashes.

## Languages

Every user-facing string, server-generated text included (match statuses, weather, rounds, competition names), lives in `locales/<lang>.json`; bundled quotes in `locales/quotes/<lang>.json`.

When `news.sources` is empty, Dash picks feeds for your country where it knows good ones (Spanish in Mexico, Argentina, Colombia, Chile, Peru or the US; English in the UK, US, Canada, Australia, Ireland, India, New Zealand or South Africa; French in Canada, Belgium or Switzerland; German in Austria or Switzerland; Italian in Switzerland; Portuguese in Portugal), and falls back to these language defaults:

| Language | News | Market news |
| --- | --- | --- |
| English (`en`) | BBC, The Guardian, NPR | Yahoo Finance, Google News |
| Spanish (`es`) | El País, 20minutos, El Mundo, Europa Press | Expansión, Google News |
| French (`fr`) | Le Monde, franceinfo, France 24, Le Figaro | Les Echos, Google News |
| Portuguese (`pt`, Brazil) | g1, BBC News Brasil, Agência Brasil | InfoMoney, Google News |
| German (`de`) | tagesschau, DER SPIEGEL, ZEIT ONLINE, DW | Handelsblatt, tagesschau, Google News |
| Italian (`it`) | RaiNews, ANSA, Agi, Il Sole 24 Ore | Il Sole 24 Ore, Google News |

What depends on the source rather than on Dash: team and player names come from ESPN, which localizes only Spanish and Brazilian Portuguese (your own display names are always used as typed); ESPN writes sports news only in English, Spanish and Portuguese, so other languages use Google News alone, without images; weather warnings and public holidays come in the languages their national service publishes, otherwise English.

To add a language: copy `locales/en.json` to `locales/<lang>.json` and translate it (missing keys fall back to English), optionally add `locales/quotes/<lang>.json`, set `"language"` in `config.json`. If the language needs special ordinals or table positions, check `ord()` and `rank()` in `server/lib/i18n.js` and `web/src/i18n.ts`.

## Data sources

All free and keyless except the voice assistant and Spotify. These are public but unofficial endpoints, used for personal, non-commercial display; their formats can change.

| Data | Source |
| --- | --- |
| Weather, UV, air quality, pollen | Open-Meteo |
| News | RSS (configurable; defaults per language and country) |
| Football, NBA/WNBA, FIBA, NFL, NHL, tennis, line-ups, rounds | ESPN public site API (`site.api.espn.com`) |
| MLB | MLB Stats API (`statsapi.mlb.com`) |
| EuroLeague / EuroCup | Official EuroLeague feeds |
| Formula 1 | Jolpica (Ergast successor) + ESPN |
| Sports news | ESPN news + Google News RSS search |
| Markets | Yahoo Finance chart endpoint |
| Quote of the day | ZenQuotes (English), bundled lists otherwise |
| Weather warnings | MeteoAlarm (EUMETNET), US National Weather Service |
| Electricity price (Spain) | Red Eléctrica (REE) `apidatos.ree.es`, PVPC |
| Public holidays | Nager.Date |
| Rain radar | RainViewer (`api.rainviewer.com`), base map from OpenStreetMap |
| Calendar | Your iCal links (parsed with `ical.js`) |
| Recipes | The recipe page's schema.org card, Gemini for pages without one; ideas from TheMealDB |
| Song lyrics | LRCLIB (`lrclib.net`) |
| Music | Spotify Web API, with your own Spotify app (Premium) |
| Voice assistant | Google Gemini Live API (`gemini-3.8-live`) with Google Search grounding |
| Location | ipwho.is / ip-api.com, BigDataCloud reverse geocoding |

## Known gaps

- Spain's ACB has no free source with fixtures, so Spanish clubs are followed through the EuroLeague or EuroCup.
- RainViewer's free tier serves only the past two hours of radar, at up to zoom 7, and has no coverage in much of Africa, South America and Asia; the radar hides itself there. OpenStreetMap's tile policy allows light use like one home display; for anything heavier, set `radar.tiles` to another provider.
- The wake word depends on the browser's speech recognition: it needs internet, isn't available in Firefox, and an English word like "Dash" can be misheard by a recognizer set to another language. The microphone button always works.
- The F1 live running order and in-game EuroLeague states were built from the documented formats but not yet seen during a live session.
