# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/xavidop/dash/security/advisories/new)). You'll get an answer within a week, and a fix or a plan for one as soon as possible after that.

Include what you found, how to reproduce it, and what it could let someone do. If you have a fix, a pull request is welcome once we've agreed on disclosure.

## Supported versions

Dash has no numbered releases yet; the `main` branch is what's supported. Keep your install up to date with `git pull`, `npm install`, `npm run build`.

## What's in scope

Dash is meant to run on a home network, so some things are by design and not vulnerabilities:

- **The HTTP API has no authentication.** Anyone on the same network can add to the shopping list, start timers, read notes or download a backup. Keep Dash on a trusted network; don't expose port 3000 to the internet.
- **Backups contain private data** (calendar links, the guest Wi-Fi password, assistant memories). Dash tells you so when you download one.

Things we do want to hear about:

- Ways to spend the Gemini API key from another device (the server mints single-use tokens for the display only, unless `assistant.allowRemote` is on)
- Leaks of secrets (API keys, Spotify tokens, calendar links) into logs, the public config endpoint or the browser
- Server-side request forgery through recipe links, calendar URLs, RSS feeds or radar tile URLs
- Injection through data from third-party feeds (news, sports, recipes) into the page
- Anything in the Windows kiosk scripts that weakens the machine beyond what the README says they do
