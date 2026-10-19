import { fetchText } from '../lib/http.js';
import { stripHtml } from './news.js';

// Recipes for cooking mode. Most recipe sites embed a schema.org Recipe card (JSON-LD) for search
// engines: that's the reliable source. Pages without one fall back to Gemini (when a key is set),
// which reads the page text and returns the same shape.

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

const decode = (s) =>
  stripHtml(String(s ?? ''))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// "10 minutes", "1 h 30 min", "5-7 min", "10 minutos", "1 Stunde", "20 minuti", "15 mn"
const UNIT = String.raw`(?:h(?:ours?|oras?|eures?|rs?)?|stunden?|std\.?|ore?|min(?:ute[ns]?|utos?|uti|s|\.)?|mn)`;
const NUM = String.raw`(\d+(?:[.,]\d+)?|an?|one|un[ao]?|uno|eine?|half an?|media)`;
const WORDS = { a: 1, an: 1, one: 1, un: 1, una: 1, uno: 1, ein: 1, eine: 1, 'half a': 0.5, 'half an': 0.5, media: 0.5 };
const TIME_RE = new RegExp(String.raw`${NUM}\s*(?:(?:-|–|to|a|à|bis)\s*\d+\s*)?(${UNIT})\b(?:\s*(?:and\s*|y\s*|et\s*|und\s*|e\s*)?(\d+)\s*min)?`, 'i');

/** Minutes mentioned in a step ("simmer 10–12 minutes" → 10), or null. Only the first time counts. */
export function stepMinutes(text) {
  const m = String(text).match(TIME_RE);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const n = WORDS[raw] ?? Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const hours = /^(h|hour|hora|heure|hr|stunde|std|ora|ore)/i.test(m[2]);
  const minutes = (hours ? n * 60 : n) + (m[3] ? Number(m[3]) : 0);
  // Ignore oven temperatures and silly values; a kitchen timer is 1 min – 12 h.
  return minutes >= 1 && minutes <= 720 ? Math.round(minutes * 10) / 10 : null;
}

/** ISO 8601 duration ("PT1H30M") → minutes. */
const isoMinutes = (d) => {
  const m = String(d || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  const v = (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0);
  return v || null;
};

/** Flattens recipeInstructions: string, list of strings, HowToStep, HowToSection (nested). */
function steps(ins) {
  const out = [];
  const add = (x) => {
    if (!x) return;
    if (typeof x === 'string') {
      // A single block of text: one step per line or sentence group.
      for (const line of decode(x.replace(/<\/?(p|li|br)[^>]*>/gi, '\n')).split(/\n+|(?<=\.)\s+(?=\d+[.)]\s)/)) if (line.trim()) out.push(line.trim());
      return;
    }
    if (Array.isArray(x)) return x.forEach(add);
    if (x.itemListElement) return add(x.itemListElement);
    if (x.text || x.name) out.push(decode(x.text || x.name));
  };
  add(ins);
  return out.map((s) => s.replace(/^\d+[.)]\s*/, '')).filter((s) => s.length > 2);
}

function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findRecipe(x);
      if (r) return r;
    }
    return null;
  }
  const type = [].concat(node['@type'] || []);
  if (type.includes('Recipe')) return node;
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') {
      const r = findRecipe(v);
      if (r) return r;
    }
  }
  return null;
}

/** Normalizes any recipe-ish object into what cooking mode shows. */
export function normalizeRecipe(r, source = null) {
  const list = (v) => [].concat(v || []).map(decode).filter(Boolean);
  const image = [].concat(r.image || [])[0];
  const stepTexts = Array.isArray(r.steps) ? r.steps.map((s) => decode(typeof s === 'string' ? s : s.text)) : steps(r.recipeInstructions);
  const out = {
    title: decode(r.name || r.title) || null,
    source,
    image: typeof image === 'string' ? image : image?.url || null,
    servings: decode([].concat(r.recipeYield || r.servings || [])[0]) || null,
    totalMinutes: isoMinutes(r.totalTime) || Number(r.totalMinutes) || null,
    ingredients: list(r.recipeIngredient || r.ingredients).slice(0, 40),
    steps: stepTexts
      .filter(Boolean)
      .slice(0, 40)
      .map((text) => ({ text, minutes: stepMinutes(text) })),
  };
  if (!out.title || !out.steps.length) throw new Error('no recipe found');
  return out;
}

export function recipeFromHtml(html, url) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const r = findRecipe(JSON.parse(m[1].trim()));
      if (r) return normalizeRecipe(r, url);
    } catch {}
  }
  return null;
}

/** Fallback for pages without a recipe card: Gemini reads the text and returns a recipe. */
async function recipeWithGemini(text, url, { key, model, language }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(40000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Extract the recipe from this web page. Keep the original language (${language} if unclear). Steps are short and in order. If there is no recipe, return an empty title.\n\nURL: ${url}\n\n${text.slice(0, 30000)}` }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            servings: { type: 'STRING' },
            ingredients: { type: 'ARRAY', items: { type: 'STRING' } },
            steps: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['title', 'ingredients', 'steps'],
        },
      },
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error?.message || `Gemini HTTP ${res.status}`);
  return normalizeRecipe(JSON.parse(d.candidates?.[0]?.content?.parts?.[0]?.text || '{}'), url);
}

export async function recipeFromUrl(url, { language = 'en', model = 'gemini-3.8-flash' } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('not a web link');
  let html;
  try {
    html = await fetchText(url, { timeoutMs: 20000, headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } });
  } catch (err) {
    throw new Error(`couldn't open the page (${err.message.replace(/ for .*/, '')})`);
  }
  const card = recipeFromHtml(html, url);
  if (card) return card;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no recipe card on that page');
  const text = decode(html.replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, ' '));
  return recipeWithGemini(text, url, { key, model, language });
}
