# Voice assistant

"Hey Dash" runs on Google's Gemini Live API.

1. Get an API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Put it in a `.env` file next to `config.json` (gitignored), or in the environment: `GEMINI_API_KEY=your-key`.
3. Switch on Settings → General → Voice assistant (or `features.assistant` in `config.json`).

Say "Dash" (or "Hey Dash, …" in one breath), or tap the microphone button (bottom left). A blue dot on the button means it's listening for the wake word.

## What you can ask

- **Anything**: it answers out loud in a sentence or two and uses Google Search for current facts.
- **About your day**: it already knows the weather, your teams' games, your calendar, the shopping list and running timers.
- **Shopping list**: "add milk and eggs", "what's on the list?", "remove the coffee".
- **Notes and reminders**: "note: call the plumber", "remind me tomorrow at 10 to call the bank".
- **Timers and alarms**: "10 minutes for the rice and 40 for the oven", "wake me at 7:30", "add 5 minutes to the rice", "how long is left?", "cancel the oven one".
- **Cooking**: "let's make carbonara for two" (Dash writes the recipe and opens cooking mode), "let's make the lasagna again", "how much butter?", "next step", "start the timer". In cooking mode, short commands ("next", "back", "repeat", "start the timer", "stop cooking", in each language) are handled on the device without Gemini.
- **Music**: "play some jazz", "play my Discover Weekly on the kitchen speaker", "next song", "louder". Dash lowers the music while it talks.
- **Memory**: "remember that the plumber is Juan, 600 123 456", later "what's the plumber's number?". "Forget the plumber" deletes it. Memories are stored locally (Settings → Kitchen lists them) and sent to Gemini as context in each conversation, so don't store anything you wouldn't say to it.
- **Morning briefing**: "good morning" or "what's today?", or automatically at the time set in Settings → General.

The conversation shows as a chat at the bottom of the screen, with a green receipt for everything it changed. Dash replies in the language you speak and keeps listening for a follow-up. Tap the card to cut it short; tap ✕ or say "thanks" to close.

## When it's connected, and what it costs

Gemini is only on the line during a conversation:

| State | What runs | Gemini cost |
| --- | --- | --- |
| Waiting for "Dash" | The browser's speech recognition | none |
| Talking | A live Gemini session | per minute |
| Closed | After `idleSeconds` (8 s) of silence, on "thanks" or ✕, or after 5 minutes at most | none |

Google's prices for `gemini-3.8-live` (October 2026; see [the pricing page](https://ai.google.dev/gemini-api/docs/pricing)): the free tier costs nothing with rate limits (Google may use free-tier data to improve its products); the paid tier is about $0.005 per minute of audio in and $0.018 per minute out, with 5,000 Google searches a month included. A typical question costs around half a cent, so 20 questions a day is roughly $3 a month. The microphone isn't sent while Dash speaks.

## Privacy and security

- **The key stays on the server.** For each conversation the server mints a single-use token valid for 30 minutes, with the model, voice, instructions and tools locked in. Only the display itself (`localhost`) may ask for a token unless `assistant.allowRemote` is set, so other devices on your Wi-Fi can't spend your key.
- **Audio goes from the browser straight to Gemini** during a conversation. Tool calls (shopping list, notes, timers…) come back to the browser and run on Dash's server.
- **Wake word**: Dash uses the browser's speech recognition (Web Speech API). In Edge and Chrome that runs on the browser vendor's online speech service, so while Dash waits for "Dash", what the microphone hears is processed by that service (not by Gemini, not stored by Dash). The last 2.5 s of audio are kept in memory on the device so "Hey Dash, what's the weather?" said in one breath reaches Gemini whole. Firefox has no speech recognition: use the microphone button there.

## Settings

`config.json` → `assistant`: `model`, `voice` (any Gemini voice, e.g. `Kore`, `Puck`, `Charon`), `wakeWords`, `idleSeconds`, `allowRemote`. On a Windows kiosk, `windows/edge-kiosk-policy.reg` allows the microphone for `http://localhost:3000` without a prompt.
