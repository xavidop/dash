# API (phone and automations)

Everything on screen can also be driven over HTTP from any device on your network (an iOS Shortcut, Home Assistant, a script). Changes appear on the display immediately. The API has no authentication: keep Dash on a trusted network.

| Endpoint | What it does |
| --- | --- |
| `POST /api/shopping` `{ "items": ["milk", "eggs"] }` | Add to the shopping list (duplicates skipped). Also `GET`, `PATCH /api/shopping/:id` `{ "done": true }`, `DELETE /api/shopping/:id`, `POST /api/shopping/clear-done` |
| `POST /api/notes` `{ "text": "…", "remindAt": "2026-10-19T10:00:00+02:00" }` | Add a note, optionally with a reminder. Also `GET`, `PATCH`, `DELETE /api/notes/:id` |
| `POST /api/timers` `{ "seconds": 600, "label": "pasta" }` | Start a timer. `PATCH /api/timers/:id` `{ "addSeconds": 60 }`, `DELETE /api/timers/:id` |
| `POST /api/countdowns` `{ "title": "Trip", "date": "2026-12-01", "yearly": false }` | Add a countdown. Also `GET`, `DELETE /api/countdowns/:id` |
| `POST /api/cooking` `{ "url": "https://…" }` | Start cooking mode from a recipe link, `{ "id" }` from the history, or `{ "idea" }` from What to cook. `PATCH /api/cooking` `{ "go": "next" }`, `POST /api/cooking/timer`, `DELETE /api/cooking`. `GET /api/recipes`, `GET /api/recipes/ideas/:id`, `POST /api/recipes/ideas/shuffle` |
| `POST /api/memories` `{ "text": "…" }` | Add something Dash remembers. Also `GET`, `DELETE /api/memories/:id` |
| `POST /api/spotify/play` `{ "query": "jazz", "device": "kitchen" }` | Play something by name, or `{ "uri", "deviceId", "from", "shuffle" }` for an exact item. `GET /api/spotify/playlists`, `GET /api/spotify/search?q=`, `GET /api/spotify/details?uri=`, `GET /api/spotify/devices`. `POST /api/spotify/control` `{ "action": "pause" }` (`play`, `next`, `previous`, `volume`, `volume_up`, `volume_down`, `shuffle`, `transfer`) |
| `GET /api/backup` | Download a backup. `POST /api/backup/restore` with the file as the body, or `{ "name" }` of a copy from `GET /api/backups` |
| `GET /api/health` | Uptime, memory, requests per source, live polling state, and the age of every data section |
| `GET /api/stream` | Server-Sent Events: the whole state, then every change |
