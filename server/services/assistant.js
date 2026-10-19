// "Hey Dash" voice assistant on the Gemini Live API.
//
// The browser talks to Gemini directly over WebSocket (audio never passes through this server), but
// it never sees the API key: the server mints a single-use ephemeral token with the whole session
// setup locked in (model, voice, instructions, tools). Gemini's constrained endpoint ignores any
// setup the client sends, so the browser can't repurpose the token. Function calls come back to the
// browser, which forwards them to POST /api/assistant/tool; they run here against the local DB.

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const LIVE_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

const S = (description) => ({ type: 'STRING', description });

/** Music tools, offered only when Spotify is connected. */
export const SPOTIFY_TOOLS = [
  {
    name: 'spotify_play',
    description: 'Play music on Spotify: a song, an artist, an album, a genre or mood ("some jazz", "relaxing music"), or one of the user\'s playlists ("my Discover Weekly"). Optionally on a named device/speaker.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: S('What to play, as the user said it, e.g. "Rosalía", "Bohemian Rhapsody Queen", "jazz for cooking", "Discover Weekly"'),
        kind: S('Optional: "track", "artist", "album" or "playlist" when clear'),
        device: S('Optional speaker/device name, e.g. "living room"'),
      },
      required: ['query'],
    },
  },
  {
    name: 'spotify_control',
    description: 'Control Spotify playback.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: S('"pause", "play" (resume), "next", "previous", "volume_up", "volume_down", "volume", "shuffle" or "transfer" (move playback to another device)'),
        volume: { type: 'NUMBER', description: 'For "volume": 0–100' },
        device: S('For "transfer": the device name'),
      },
      required: ['action'],
    },
  },
  { name: 'spotify_devices', description: 'List the Spotify devices (speakers, phones, computers) that are on.' },
];

export const TOOLS = [
  { googleSearch: {} },
  {
    functionDeclarations: [
      {
        name: 'add_to_shopping_list',
        description: 'Add one or more items to the household shopping list shown on the display.',
        parameters: { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: S('One item, short, e.g. "milk" or "2 kg of oranges"') } }, required: ['items'] },
      },
      {
        name: 'remove_from_shopping_list',
        description: 'Remove items from the shopping list (bought or no longer needed).',
        parameters: { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: S('Item name as it appears on the list') } }, required: ['items'] },
      },
      { name: 'get_shopping_list', description: 'Read the current shopping list.' },
      {
        name: 'add_note',
        description: 'Save a note on the display. Optionally with a reminder time, when it pops up full-screen.',
        parameters: {
          type: 'OBJECT',
          properties: { text: S('The note'), remind_at: S('Optional local date-time for a reminder, "YYYY-MM-DDTHH:MM"') },
          required: ['text'],
        },
      },
      {
        name: 'start_timer',
        description: 'Start a kitchen timer on the display: for a duration ("10 minutes") or until a clock time ("at 18:30", an alarm). Up to 6 at once.',
        parameters: {
          type: 'OBJECT',
          properties: {
            minutes: { type: 'NUMBER', description: 'Duration in minutes (may be fractional). Omit when `at` is given.' },
            at: S('Local clock time "HH:MM" to ring at (today, or tomorrow if already past). Omit when `minutes` is given.'),
            label: S('Optional label, e.g. "pasta"'),
          },
        },
      },
      { name: 'list_timers', description: 'Read the running timers and how long each has left.' },
      {
        name: 'add_time_to_timer',
        description: 'Add (or with a negative number, remove) minutes to a running timer.',
        parameters: { type: 'OBJECT', properties: { minutes: { type: 'NUMBER', description: 'Minutes to add' }, label: S('Which timer, by label; omit if there is only one') }, required: ['minutes'] },
      },
      {
        name: 'cancel_timer',
        description: 'Stop a timer (or all of them). Also silences a timer that is ringing.',
        parameters: { type: 'OBJECT', properties: { label: S('Which timer, by label; omit if there is only one'), all: { type: 'BOOLEAN', description: 'Stop every timer' } } },
      },
      {
        name: 'remember',
        description: 'Save a fact the household wants Dash to remember (people, phone numbers, codes, preferences, where things are). Store it as one self-contained sentence.',
        parameters: { type: 'OBJECT', properties: { fact: S('E.g. "The plumber is Juan, phone 600 123 456"') }, required: ['fact'] },
      },
      {
        name: 'forget',
        description: 'Delete remembered facts that match these words.',
        parameters: { type: 'OBJECT', properties: { about: S('Words that identify the fact, e.g. "plumber"') }, required: ['about'] },
      },
      {
        name: 'start_recipe',
        description:
          'Open cooking mode on the display with a recipe: big step-by-step instructions the user follows while cooking. Use it when the user wants to cook something. Write a good, authentic recipe (search if needed) in the user\'s language, scaled to the servings they ask for. Every step that takes time must say how long in minutes, with a number ("cook the spaghetti for 9 minutes", "simmer for 15 minutes"): the display turns those into one-tap timers. Never write "until al dente" without a time.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: S('Dish name'),
            servings: S('E.g. "4 servings"'),
            ingredients: { type: 'ARRAY', items: S('One ingredient with quantity') },
            steps: { type: 'ARRAY', items: S('One short step, with its time in minutes when it takes time') },
          },
          required: ['title', 'ingredients', 'steps'],
        },
      },
      {
        name: 'open_saved_recipe',
        description: 'Open a recipe cooked before (from the display\'s recipe history) by name.',
        parameters: { type: 'OBJECT', properties: { name: S('Part of the recipe title') }, required: ['name'] },
      },
      {
        name: 'recipe_step',
        description: 'Move through the recipe on screen.',
        parameters: { type: 'OBJECT', properties: { go: S('"next", "previous", "first", or a step number like "3"') }, required: ['go'] },
      },
      { name: 'start_step_timer', description: 'Start a timer for the time mentioned in the current recipe step.' },
      { name: 'stop_cooking', description: 'Close cooking mode.' },
      { name: 'end_conversation', description: 'Close the assistant when the user is done (e.g. "thanks", "that is all"). Say a short goodbye first.' },
    ],
  },
];

/** Offset like "+02:00" of a time zone at a given instant. */
function tzOffset(timezone, at = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : 'Z';
}

/** "2026-10-17T19:30" in `timezone` → epoch ms. */
export function localToEpoch(local, timezone) {
  const m = String(local || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) return null;
  const guess = new Date(`${m[1]}T${m[2]}:00Z`);
  const ms = Date.parse(`${m[1]}T${m[2]}:00${tzOffset(timezone, guess)}`);
  return Number.isFinite(ms) ? ms : null;
}

export class AssistantService {
  constructor({ config, store, db, timers, cooking, spotify, languageName, onChange }) {
    this.spotify = spotify;
    this.cooking = cooking;
    this.config = config;
    this.store = store;
    this.db = db;
    this.timers = timers;
    this.languageName = languageName;
    this.onChange = onChange; // (section) => void, to publish DB changes
    this.lastSession = 0;
  }

  get key() {
    return process.env.GEMINI_API_KEY || '';
  }

  get enabled() {
    return !!(this.key && this.config.features.assistant);
  }

  /** What Dash knows right now, so "when do Valencia play?" doesn't need a web search. */
  context() {
    const tz = this.config.timezone;
    const now = new Date();
    const fmt = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const lines = [`Now: ${now.toLocaleString('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' })} (${tz}).`];
    const loc = this.store.get('location')?.data;
    if (loc?.city) lines.push(`The display is in ${loc.city}${loc.country ? `, ${loc.country}` : ''}.`);
    const w = this.store.get('weather')?.data;
    if (w) lines.push(`Weather now: ${w.current.temp}°C, ${w.current.desc}; today ${w.today.min}–${w.today.max}°C, rain chance ${w.today.precip}%.`);
    const teams = this.store.get('teams')?.data?.teams || [];
    for (const c of teams.slice(0, 10)) {
      const g = c.next;
      const last = c.last;
      const bits = [];
      if (last) bits.push(`last: ${last.home.name} ${last.home.score ?? ''}-${last.away.score ?? ''} ${last.away.name} (${last.league.name})`);
      if (g) bits.push(`next: ${g.home.name} vs ${g.away.name}, ${fmt(g.start)} (${g.league.name})`);
      if (bits.length) lines.push(`Followed team ${c.name}: ${bits.join('; ')}.`);
    }
    const events = (this.store.get('calendar')?.data?.events || []).slice(0, 12);
    if (events.length) lines.push(`Calendar: ${events.map((e) => `${e.title || 'event'} (${e.allDay ? e.start : fmt(e.start)})`).join('; ')}.`);
    const alerts = this.store.get('alerts')?.data?.alerts || [];
    if (alerts.length) lines.push(`Weather warnings: ${alerts.map((a) => `${a.level} ${a.event} until ${fmt(a.expires)}`).join('; ')}.`);
    const hol = this.store.get('holidays')?.data;
    if (hol?.today) lines.push(`Today is a public holiday: ${hol.today.name}.`);
    else if (hol?.tomorrow) lines.push(`Tomorrow is a public holiday: ${hol.tomorrow.name}.`);
    const today = now.toLocaleDateString('en-CA', { timeZone: tz });
    const reminders = this.db.notes().filter((n) => n.remindAt && !n.reminded && new Date(n.remindAt).toLocaleDateString('en-CA', { timeZone: tz }) === today);
    if (reminders.length) lines.push(`Reminders today: ${reminders.map((n) => `${n.text} (${fmt(new Date(n.remindAt).toISOString())})`).join('; ')}.`);
    const bins = this.binsToday();
    if (bins.length) lines.push(`Bins: ${bins.join('; ')}.`);
    const news = (this.store.get('news')?.data?.items || []).slice(0, 3);
    if (news.length) lines.push(`Top headlines: ${news.map((n) => n.title).join(' | ')}.`);
    const cook = this.cooking?.current();
    if (cook) {
      lines.push(`COOKING MODE is open: "${cook.title}" (${cook.servings || 'servings not given'}), on step ${cook.step + 1} of ${cook.steps.length}: "${cook.steps[cook.step].text}".`);
      lines.push(`Ingredients: ${cook.ingredients.join('; ')}.`);
      lines.push(`All steps: ${cook.steps.map((s, i) => `${i + 1}. ${s.text}`).join(' ')}`);
    }
    const music = this.spotify?.enabled && this.spotify.connected ? this.store.get('spotify')?.data : null;
    if (music?.item) lines.push(`Spotify: ${music.playing ? 'playing' : 'paused'} "${music.item.name}" by ${music.item.by}${music.device ? ` on ${music.device.name}` : ''}.`);
    const memories = this.db.memories();
    if (memories.length) lines.push(`Things the household asked you to remember:\n${memories.map((m) => `- ${m.text}`).join('\n')}`);
    const shopping = this.db.shopping().filter((x) => !x.done);
    lines.push(shopping.length ? `Shopping list: ${shopping.map((x) => x.text).join(', ')}.` : 'The shopping list is empty.');
    const timers = this.store.get('timers')?.data?.timers || [];
    if (timers.length) lines.push(`Running timers: ${timers.map((t) => `${t.label || 'timer'} ends ${fmt(new Date(t.endsAt).toISOString())}`).join('; ')}.`);
    return lines.join('\n');
  }

  /** "Recycling goes out tonight" / "Recycling collection today", from config.bins. */
  binsToday() {
    const tz = this.config.timezone;
    const dow = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
    const idx = (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(d);
    const today = idx(dow(0));
    const tomorrow = idx(dow(1));
    return (this.config.bins || []).flatMap((b) => {
      const days = [].concat(b.weekdays || []).map(Number);
      if (b.evening && days.includes(tomorrow)) return [`${b.name} goes out tonight (collected tomorrow)`];
      if (!b.evening && days.includes(today)) return [`${b.name} collection today`];
      return [];
    });
  }

  setup() {
    const a = this.config.assistant;
    const name = this.config.userName ? ` The user's name is ${this.config.userName}.` : '';
    return {
      model: `models/${a.model}`,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: a.voice } } } },
      systemInstruction: {
        parts: [
          {
            text: [
              `You are Dash, the voice assistant of a family's kitchen wall display.${name}`,
              `Reply in the language the user is speaking; if unclear, use ${this.languageName()}. Keep that language for the whole conversation. Your answers are spoken aloud and shown as a chat on the screen: no lists, no markdown, no URLs.`,
              'Talk like a friendly person in the kitchen, not a search engine: natural and relaxed, usually one or two short sentences. Answer first, then, when it genuinely helps, add a short follow-up ("Want me to set a timer?", "Anything else for the list?"). Never repeat back the whole question, and don\'t introduce yourself unless asked.',
              'Use Google Search for anything current (news, scores not listed below, opening hours, facts you are unsure of). Use the tools to change the shopping list, save notes and set up timers and alarms (start, list, add time, cancel); never claim you did it without calling the tool.',
              'When the user says thanks or is done, say goodbye in a few words and call end_conversation.',
              'Morning briefing: when the user says good morning, asks for a briefing or "what\'s today", or the message is "[briefing]", give a warm briefing of about five short sentences: the weather now and today (and any warning), what\'s on the calendar and reminders today, your teams\' latest results or games today, bins, and one top headline. Skip what is empty. Then stop; don\'t ask a question.',
              'Memory: when told to remember something, call remember with one clear sentence. Use the remembered facts below to answer, quoting numbers and codes exactly.',
              'Music: if Spotify tools are available, use them for "play …", "pause", "next song", "louder", "what\'s playing". The assistant lowers the music while you talk and restores it after; don\'t mention that.',
              'Cooking: when the user wants to cook, call start_recipe (or open_saved_recipe for one cooked before), then say the first step. While cooking mode is open, "next", "back", "repeat", "how much …" refer to the recipe; read steps naturally and offer the step timer when a step has a time.',
              '',
              this.context(),
            ].join('\n'),
          },
        ],
      },
      tools: this.spotify?.enabled && this.spotify.connected ? [TOOLS[0], { functionDeclarations: [...TOOLS[1].functionDeclarations, ...SPOTIFY_TOOLS] }] : TOOLS,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
  }

  /** Mints a single-use token valid for 30 min (a new session must start within 1 min). */
  async session() {
    if (!this.enabled) throw Object.assign(new Error('assistant disabled'), { status: 404 });
    if (Date.now() - this.lastSession < 2000) throw Object.assign(new Error('too many sessions'), { status: 429 });
    this.lastSession = Date.now();
    const iso = (min) => new Date(Date.now() + min * 60e3).toISOString();
    const res = await fetch(`${API}/auth_tokens`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.key, 'content-type': 'application/json' },
      body: JSON.stringify({ uses: 1, expireTime: iso(30), newSessionExpireTime: iso(1), bidiGenerateContentSetup: this.setup() }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.name) throw Object.assign(new Error(d.error?.message || `token request failed (HTTP ${res.status})`), { status: 502 });
    return { url: `${LIVE_WS}?access_token=${encodeURIComponent(d.name)}`, idleSeconds: this.config.assistant.idleSeconds };
  }

  timerList() {
    return this.timers.timers.map((x) => ({ label: x.label || null, minutes_left: Math.max(0, Math.round((x.endsAt - Date.now()) / 6000) / 10), ringing: x.endsAt <= Date.now() }));
  }

  /** The timer the user means: by label (loose match), or the only one there is. */
  findTimer(label) {
    const all = this.timers.timers;
    if (label) {
      const want = String(label).toLowerCase();
      return all.find((x) => x.label.toLowerCase() === want) || all.find((x) => x.label && (x.label.toLowerCase().includes(want) || want.includes(x.label.toLowerCase()))) || null;
    }
    return all.length === 1 ? all[0] : null;
  }

  /** Spotify calls are async; their errors go back to the model so it can explain them. */
  async spotifyTool(name, args) {
    if (!this.spotify?.connected) return { error: 'Spotify is not connected (Settings → General → Spotify)' };
    try {
      if (name === 'spotify_devices') return { devices: await this.spotify.devices() };
      if (name === 'spotify_play') return await this.spotify.play(args);
      return await this.spotify.control(args.action, args);
    } catch (err) {
      return { error: err.message, ...(err.reason === 'PREMIUM_REQUIRED' ? { hint: 'Spotify Premium is needed to control playback' } : {}) };
    }
  }

  cookingTool(name, args) {
    try {
      if (name === 'stop_cooking') return this.cooking.stop('assistant') ?? { closed: true };
      if (name === 'start_step_timer') {
        const tm = this.cooking.timer(args.minutes);
        return { started: true, minutes: Math.round(tm.seconds / 6) / 10, label: tm.label };
      }
      const c = name === 'start_recipe' ? this.cooking.startFrom(args) : name === 'open_saved_recipe' ? this.cooking.open({ name: args.name }) : this.cooking.go(args.go);
      const s = c.steps[c.step];
      return { title: c.title, step: c.step + 1, of: c.steps.length, text: s.text, minutes: s.minutes };
    } catch (err) {
      return { error: err.message };
    }
  }

  /** Runs a function call from the model. Returns the JSON sent back as the function response. */
  tool(name, args = {}) {
    switch (name) {
      case 'add_to_shopping_list': {
        const added = this.db.addShopping(args.items);
        this.onChange('shopping');
        return { added: added.map((x) => x.text), list: this.db.shopping().filter((x) => !x.done).map((x) => x.text) };
      }
      case 'remove_from_shopping_list': {
        const removed = this.db.removeShopping({ names: args.items });
        this.onChange('shopping');
        return { removed, list: this.db.shopping().filter((x) => !x.done).map((x) => x.text) };
      }
      case 'get_shopping_list':
        return { list: this.db.shopping().filter((x) => !x.done).map((x) => x.text) };
      case 'add_note': {
        const text = String(args.text || '').trim();
        if (!text) return { error: 'empty note' };
        const remindAt = args.remind_at ? localToEpoch(args.remind_at, this.config.timezone) : null;
        const note = this.db.addNote({ text, remindAt });
        this.onChange('notes');
        return { saved: true, reminder: note.remindAt ? new Date(note.remindAt).toLocaleString('en-GB', { timeZone: this.config.timezone }) : null, remindAt: note.remindAt || null };
      }
      case 'start_timer': {
        let seconds = Math.round(Number(args.minutes) * 60);
        const at = String(args.at || '').match(/^(\d{1,2}):(\d{2})$/);
        if (at) {
          const today = new Date().toLocaleDateString('en-CA', { timeZone: this.config.timezone });
          let when = localToEpoch(`${today}T${at[1].padStart(2, '0')}:${at[2]}`, this.config.timezone);
          if (when != null && when <= Date.now()) when += 864e5;
          seconds = when == null ? NaN : Math.ceil((when - Date.now()) / 1000); // ring on the minute, never early
        }
        if (!(seconds >= 5 && seconds <= 24 * 3600)) return { error: 'give minutes (up to 1440) or a clock time "HH:MM"' };
        try {
          const tm = this.timers.add(seconds, String(args.label || '').slice(0, 40));
          return { started: true, minutes: Math.round(seconds / 6) / 10, endsAt: tm.endsAt, label: tm.label || null };
        } catch (err) {
          return { error: err.message };
        }
      }
      case 'list_timers':
        return { timers: this.timerList() };
      case 'add_time_to_timer': {
        const tm = this.findTimer(args.label);
        if (!tm) return { error: this.timers.timers.length ? 'which timer? say its label' : 'no timers running', timers: this.timerList() };
        this.timers.extend(tm.id, Math.round(Number(args.minutes) * 60) || 0);
        return { ok: true, label: tm.label || null, minutes_left: Math.round((tm.endsAt - Date.now()) / 6000) / 10 };
      }
      case 'cancel_timer': {
        const list = args.all ? [...this.timers.timers] : [this.findTimer(args.label)].filter(Boolean);
        if (!list.length) return { error: this.timers.timers.length ? 'which timer? say its label' : 'no timers running', timers: this.timerList() };
        for (const tm of list) this.timers.remove(tm.id);
        return { cancelled: list.map((x) => x.label || 'timer') };
      }
      case 'remember': {
        const m = this.db.remember(args.fact);
        return { saved: m.text };
      }
      case 'forget': {
        const gone = this.db.forget({ about: args.about });
        return gone.length ? { forgotten: gone.map((m) => m.text) } : { error: 'nothing matched' };
      }
      case 'start_recipe':
      case 'open_saved_recipe':
      case 'recipe_step':
      case 'start_step_timer':
      case 'stop_cooking':
        return this.cookingTool(name, args);
      case 'spotify_play':
      case 'spotify_control':
      case 'spotify_devices':
        return this.spotifyTool(name, args);
      case 'end_conversation':
        return { ok: true };
      default:
        return { error: `unknown tool ${name}` };
    }
  }
}
