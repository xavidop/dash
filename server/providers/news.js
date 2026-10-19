import { XMLParser } from 'fast-xml-parser';
import { fetchText, settleAll } from '../lib/http.js';

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
});

const STOPWORDS = new Set(
  (
    'el la los las un una unos unas de del al a en y o u que se su sus por para con sin sobre tras ante es son ha han lo le les como mas más pero ya este esta estos estas ese esa eso entre hasta desde muy tambien también no si sí ' +
    'the a an of to in on at for and or but with from by as is are was were be been has have had it its this that these those not after over into about'
  ).split(' '),
);

export const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
export const text = (x) => (x == null ? '' : typeof x === 'object' ? String(x['#text'] ?? '') : String(x));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ntilde: 'ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', iexcl: '¡', iquest: '¿', laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };

export function stripHtml(s) {
  return String(s || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(title) {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.min(a.size, b.size);
}

function findImage(item) {
  const candidates = [
    ...asArray(item['media:content']).map((m) => (m?.['@medium'] === 'video' ? null : m?.['@url'])),
    ...asArray(item['media:thumbnail']).map((m) => m?.['@url']),
    ...asArray(item.enclosure).filter((e) => !e?.['@type'] || String(e['@type']).startsWith('image')).map((e) => e?.['@url']),
  ];
  // media:group wrappers
  for (const g of asArray(item['media:group'])) candidates.push(...asArray(g?.['media:content']).map((m) => m?.['@url']));
  const html = text(item['content:encoded']) + ' ' + text(item.description);
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m) candidates.push(m[1]);
  return candidates.find((u) => u && /^https?:\/\//.test(u) && !/imrworldwide|pixel|tracking|1x1/i.test(u)) || null;
}

/** Used when config.news.sources is empty. */
const DEFAULT_SOURCES = {
  es: [
    { name: 'El País', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada' },
    { name: '20minutos', url: 'https://www.20minutos.es/rss/' },
    { name: 'El Mundo', url: 'https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml' },
    { name: 'Europa Press', url: 'https://www.europapress.es/rss/rss.aspx' },
  ],
  en: [
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
    { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  ],
  fr: [
    { name: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml' },
    { name: 'franceinfo', url: 'https://www.francetvinfo.fr/titres.rss' },
    { name: 'France 24', url: 'https://www.france24.com/fr/rss' },
    { name: 'Le Figaro', url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml' },
  ],
  de: [
    { name: 'tagesschau', url: 'https://www.tagesschau.de/xml/rss2/' },
    { name: 'DER SPIEGEL', url: 'https://www.spiegel.de/schlagzeilen/index.rss' },
    { name: 'ZEIT ONLINE', url: 'https://newsfeed.zeit.de/index' },
    { name: 'DW', url: 'https://rss.dw.com/xml/rss-de-all' },
  ],
  it: [
    { name: 'RaiNews', url: 'https://www.rainews.it/rss/tutti' },
    { name: 'ANSA', url: 'https://www.ansa.it/sito/ansait_rss.xml' },
    { name: 'Agi', url: 'https://www.agi.it/cronaca/rss' },
    { name: 'Il Sole 24 Ore', url: 'https://www.ilsole24ore.com/rss/italia.xml' },
  ],
  pt: [
    { name: 'g1', url: 'https://g1.globo.com/rss/g1/' },
    { name: 'BBC News Brasil', url: 'https://feeds.bbci.co.uk/portuguese/rss.xml' },
    { name: 'Agência Brasil', url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml' },
  ],
};

/** Per-country defaults keyed `${language}-${country}`; win over DEFAULT_SOURCES when the country is known. */
const COUNTRY_SOURCES = {
  'es-MX': [
    { name: 'El Universal', url: 'https://www.eluniversal.com.mx/arc/outboundfeeds/rss/?outputType=xml' },
    { name: 'El Financiero', url: 'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/?outputType=xml' },
    { name: 'Expansión', url: 'https://expansion.mx/rss' },
    { name: 'La Jornada', url: 'https://www.jornada.com.mx/rss/edicion.xml' },
  ],
  'es-AR': [
    { name: 'Clarín', url: 'https://www.clarin.com/rss/lo-ultimo/' },
    { name: 'La Nación', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml' },
    { name: 'Infobae', url: 'https://www.infobae.com/arc/outboundfeeds/rss/' },
    { name: 'TN', url: 'https://tn.com.ar/arc/outboundfeeds/rss/?outputType=xml' },
  ],
  'es-CO': [
    { name: 'El Tiempo', url: 'https://www.eltiempo.com/rss/colombia.xml' },
    { name: 'Semana', url: 'https://www.semana.com/arc/outboundfeeds/rss/?outputType=xml' },
    { name: 'El Colombiano', url: 'https://www.elcolombiano.com/rss/portada.xml' },
  ],
  'es-CL': [
    { name: 'La Tercera', url: 'https://www.latercera.com/arc/outboundfeeds/rss/?outputType=xml' },
    { name: 'Cooperativa', url: 'https://www.cooperativa.cl/noticias/site/tax/port/all/rss_3___1.xml' },
    { name: 'The Clinic', url: 'https://www.theclinic.cl/feed/' },
  ],
  'es-PE': [
    { name: 'El Comercio', url: 'https://elcomercio.pe/arcio/rss/' },
    { name: 'RPP', url: 'https://rpp.pe/feed' },
    { name: 'La República', url: 'https://larepublica.pe/rss/home.xml' },
    { name: 'Andina', url: 'https://andina.pe/agencia/rss/0.xml' },
  ],
  'es-US': [
    { name: 'La Opinión', url: 'https://laopinion.com/feed/' },
    { name: 'El Diario', url: 'https://eldiariony.com/feed/' },
    { name: 'Google News', url: 'https://news.google.com/rss?hl=es-419&gl=US&ceid=US:es-419', splitSource: true },
  ],
  'en-GB': [
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/uk-news/rss' },
    { name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/home.xml' },
    { name: 'The Independent', url: 'https://www.independent.co.uk/news/uk/rss' },
  ],
  'en-US': [
    { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
    { name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
    { name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news' },
    { name: 'PBS NewsHour', url: 'https://www.pbs.org/newshour/feeds/rss/headlines' },
  ],
  'en-CA': [
    { name: 'CBC News', url: 'https://www.cbc.ca/webfeed/rss/rss-topstories' },
    { name: 'Global News', url: 'https://globalnews.ca/feed/' },
    { name: 'The Globe and Mail', url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/' },
  ],
  'en-AU': [
    { name: 'ABC News', url: 'https://www.abc.net.au/news/feed/51120/rss.xml' },
    { name: 'The Guardian', url: 'https://www.theguardian.com/australia-news/rss' },
    { name: 'The Sydney Morning Herald', url: 'https://www.smh.com.au/rss/feed.xml' },
  ],
  'en-IE': [
    { name: 'RTÉ News', url: 'https://www.rte.ie/feeds/rss/?index=/news/' },
    { name: 'The Irish Times', url: 'https://www.irishtimes.com/arc/outboundfeeds/feed-irish-news/?from=0&size=50' },
    { name: 'Irish Independent', url: 'https://www.independent.ie/irish-news/rss' },
    { name: 'TheJournal.ie', url: 'https://www.thejournal.ie/feed/' },
  ],
  'en-IN': [
    { name: 'The Hindu', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
    { name: 'Hindustan Times', url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml' },
    { name: 'The Indian Express', url: 'https://indianexpress.com/section/india/feed/' },
    { name: 'NDTV', url: 'https://feeds.feedburner.com/ndtvnews-top-stories' },
  ],
  'en-NZ': [
    { name: 'RNZ', url: 'https://www.rnz.co.nz/rss/national.xml' },
    { name: 'NZ Herald', url: 'https://www.nzherald.co.nz/arc/outboundfeeds/rss/curated/78/?outputType=xml&_website=nzh' },
    { name: '1News', url: 'https://www.1news.co.nz/arc/outboundfeeds/rss/?outputType=xml' },
    { name: 'Stuff', url: 'https://www.stuff.co.nz/rss' },
  ],
  'en-ZA': [
    { name: 'IOL', url: 'https://iol.co.za/rss' },
    { name: 'Daily Maverick', url: 'https://www.dailymaverick.co.za/dmrss/' },
    { name: 'SABC News', url: 'https://www.sabcnews.com/sabcnews/feed/' },
  ],
  'fr-CA': [
    { name: 'Radio-Canada', url: 'https://ici.radio-canada.ca/rss/4159' },
    { name: 'La Presse', url: 'https://www.lapresse.ca/actualites/rss' },
    { name: 'Le Devoir', url: 'https://www.ledevoir.com/rss/manchettes.xml' },
    { name: 'TVA Nouvelles', url: 'https://www.tvanouvelles.ca/rss.xml' },
  ],
  'fr-BE': [
    { name: 'RTBF', url: 'https://rss.rtbf.be/article/rss/highlight_rtbf_info.xml' },
    { name: 'Le Soir', url: 'https://www.lesoir.be/rss2/2/cible_principale' },
    { name: 'La Libre', url: 'https://www.lalibre.be/arc/outboundfeeds/rss/?outputType=xml' },
  ],
  'fr-CH': [
    { name: 'RTS', url: 'https://www.rts.ch/info/?format=rss/news' },
    { name: 'Le Temps', url: 'https://www.letemps.ch/articles.rss' },
    { name: '24 heures', url: 'https://www.24heures.ch/rss.html' },
    { name: 'Tribune de Genève', url: 'https://www.tdg.ch/rss.html' },
  ],
  'de-AT': [
    { name: 'DER STANDARD', url: 'https://www.derstandard.at/rss' },
    { name: 'Krone', url: 'https://api.krone.at/v1/rss/rssfeed-google.xml?id=2311992' },
    { name: 'KURIER', url: 'https://kurier.at/xml/rssd' },
    { name: 'Kleine Zeitung', url: 'https://www.kleinezeitung.at/rss/hp_stmk' },
  ],
  'de-CH': [
    { name: 'SRF News', url: 'https://www.srf.ch/news/bnf/rss/1646' },
    { name: 'NZZ', url: 'https://www.nzz.ch/recent.rss' },
    { name: 'Tages-Anzeiger', url: 'https://www.tagesanzeiger.ch/rss.html' },
    { name: 'Blick', url: 'https://www.blick.ch/rss.xml' },
  ],
  'it-CH': [
    { name: 'RSI', url: 'https://www.rsi.ch/info/?f=rss' },
    { name: 'Google News', url: 'https://news.google.com/rss?hl=it&gl=CH&ceid=CH:it', splitSource: true },
  ],
  'pt-PT': [
    { name: 'RTP Notícias', url: 'https://www.rtp.pt/noticias/rss' },
    { name: 'Público', url: 'https://feeds.feedburner.com/PublicoRSS' },
    { name: 'Observador', url: 'https://observador.pt/feed/' },
  ],
};

/** Market news (Mercados side column) when config.finance.newsSources is empty. `{symbols}` is filled in. */
const MARKET_SOURCES = {
  es: [
    { name: 'Expansión', url: 'https://e00-expansion.uecdn.es/rss/mercados.xml' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=bolsa+OR+Ibex+OR+%22mercados+financieros%22+when:1d&hl=es&gl=ES&ceid=ES:es', splitSource: true },
  ],
  en: [
    { name: 'Yahoo Finance', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbols}&region=US&lang=en-US', needsSymbols: true },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=%22stock+market%22+OR+stocks+OR+%22Wall+Street%22+when:1d&hl=en-US&gl=US&ceid=US:en', splitSource: true },
  ],
  fr: [
    { name: 'Les Echos', url: 'https://services.lesechos.fr/rss/les-echos-finance-marches.xml' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=bourse+OR+%22CAC+40%22+OR+%22march%C3%A9s+financiers%22+when:1d&hl=fr&gl=FR&ceid=FR:fr', splitSource: true },
  ],
  de: [
    { name: 'Handelsblatt', url: 'https://www.handelsblatt.com/contentexport/feed/finanzen' },
    { name: 'tagesschau', url: 'https://www.tagesschau.de/wirtschaft/index~rss2.xml' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=B%C3%B6rse+OR+DAX+OR+Aktien+when:1d&hl=de&gl=DE&ceid=DE:de', splitSource: true },
  ],
  it: [
    { name: 'Il Sole 24 Ore', url: 'https://www.ilsole24ore.com/rss/finanza.xml' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=Borsa+OR+%22Piazza+Affari%22+OR+%22FTSE+MIB%22+when:1d&hl=it&gl=IT&ceid=IT:it', splitSource: true },
  ],
  pt: [
    { name: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=Ibovespa+OR+bolsa+OR+%22mercado+financeiro%22+when:1d&hl=pt-BR&gl=BR&ceid=BR:pt-419', splitSource: true },
  ],
};

/** Per-country market news keyed `${language}-${country}`; win over MARKET_SOURCES when the country is known. */
const COUNTRY_MARKET_SOURCES = {
  'en-GB': [
    { name: 'The Guardian', url: 'https://www.theguardian.com/uk/business/rss' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=FTSE+OR+%22stock+market%22+OR+%22London+Stock+Exchange%22+when:1d&hl=en-GB&gl=GB&ceid=GB:en', splitSource: true },
  ],
  'en-CA': [
    { name: 'The Globe and Mail', url: 'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/business/' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=TSX+OR+%22stock+market%22+OR+%22Bay+Street%22+when:1d&hl=en-CA&gl=CA&ceid=CA:en', splitSource: true },
  ],
  'en-AU': [
    { name: 'The Sydney Morning Herald', url: 'https://www.smh.com.au/rss/business.xml' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=ASX+OR+%22stock+market%22+OR+%22share+market%22+when:1d&hl=en-AU&gl=AU&ceid=AU:en', splitSource: true },
  ],
  'en-IN': [
    { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
    { name: 'Mint', url: 'https://www.livemint.com/rss/markets' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=Sensex+OR+Nifty+OR+%22stock+market%22+when:1d&hl=en-IN&gl=IN&ceid=IN:en', splitSource: true },
  ],
  'es-MX': [
    { name: 'El Financiero', url: 'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/category/mercados/?outputType=xml' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=BMV+OR+%22Bolsa+Mexicana%22+OR+peso+OR+mercados+when:1d&hl=es-419&gl=MX&ceid=MX:es-419', splitSource: true },
  ],
  'es-AR': [
    { name: 'Ámbito', url: 'https://www.ambito.com/rss/pages/finanzas.xml' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=Merval+OR+%22riesgo+pa%C3%ADs%22+OR+d%C3%B3lar+OR+bonos+when:1d&hl=es-419&gl=AR&ceid=AR:es-419', splitSource: true },
  ],
  'pt-PT': [
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=PSI+OR+bolsa+OR+%22Euronext+Lisboa%22+OR+mercados+when:1d&hl=pt-PT&gl=PT&ceid=PT:pt-150', splitSource: true },
  ],
  'de-AT': [
    { name: 'DER STANDARD', url: 'https://www.derstandard.at/rss/wirtschaft' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=ATX+OR+%22Wiener+B%C3%B6rse%22+OR+B%C3%B6rse+when:1d&hl=de&gl=AT&ceid=AT:de', splitSource: true },
  ],
  'de-CH': [
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=SMI+OR+B%C3%B6rse+OR+%22Schweizer+Aktien%22+when:1d&hl=de&gl=CH&ceid=CH:de', splitSource: true },
  ],
  'fr-CA': [
    { name: 'La Presse', url: 'https://www.lapresse.ca/affaires/rss' },
    { name: 'Google News', url: 'https://news.google.com/rss/search?q=Bourse+OR+TSX+OR+%22march%C3%A9s+financiers%22+when:1d&hl=fr-CA&gl=CA&ceid=CA:fr', splitSource: true },
  ],
};

export class NewsProvider {
  /**
   * @param {object} opts
   * @param {string} opts.language
   * @param {string} [opts.country]                    ISO 3166 alpha-2 (e.g. 'MX'); picks per-country defaults
   * @param {{name,url,splitSource?}[]} [opts.sources]   empty → defaults for the language (and country)
   * @param {'general'|'markets'} [opts.kind]
   * @param {() => string[]} [opts.symbols]            for market feeds that take ticker lists
   */
  constructor({ language, country, sources, maxAgeHours = 24, kind = 'general', symbols = () => [] }) {
    const defaults = kind === 'markets' ? MARKET_SOURCES : DEFAULT_SOURCES;
    const byCountry = kind === 'markets' ? COUNTRY_MARKET_SOURCES : COUNTRY_SOURCES;
    const countryKey = country ? `${language}-${String(country).toUpperCase()}` : null;
    this.sources = sources?.length ? sources : (countryKey && byCountry[countryKey]) || defaults[language] || defaults.en;
    this.maxAgeMs = maxAgeHours * 3600e3;
    this.symbols = symbols;
  }

  async fetchSource(src) {
    let url = src.url;
    if (url.includes('{symbols}')) {
      const syms = this.symbols().filter((s) => /^[A-Z0-9.\-^=]+$/i.test(s)).slice(0, 10);
      if (!syms.length) return [];
      url = url.replace('{symbols}', encodeURIComponent(syms.join(',')));
    }
    const xml = await fetchText(url);
    const doc = parser.parse(xml);
    const items = asArray(doc?.rss?.channel?.item ?? doc?.feed?.entry);
    return items.map((it) => {
      let title = stripHtml(text(it.title));
      let source = src.name;
      // Aggregators (Google News) end titles with " - Publisher".
      if (src.splitSource) {
        const cut = title.lastIndexOf(' - ');
        if (cut > 0) {
          source = text(it.source) || title.slice(cut + 3);
          title = title.slice(0, cut);
        }
      }
      const link = text(it.link?.['@href'] ?? it.link) || text(it.guid);
      const date = new Date(text(it.pubDate || it['dc:date'] || it.updated || it.published));
      const summary = stripHtml(text(it.description || it.summary || it['media:description'])).slice(0, 280);
      return {
        id: link || title,
        title,
        summary,
        link,
        image: findImage(it),
        source,
        publishedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      };
    });
  }

  async fetch() {
    const results = await settleAll(this.sources.map((s) => () => this.fetchSource(s)), 4);
    const ok = results.filter(Boolean);
    if (!ok.length) throw new Error('all news sources failed');

    const now = Date.now();
    // Round-robin across sources so one feed can't dominate, newest first within each feed.
    const perSource = ok.map((list) =>
      list
        .filter((i) => i.title && i.publishedAt && now - Date.parse(i.publishedAt) < this.maxAgeMs && Date.parse(i.publishedAt) <= now + 3600e3)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    );
    const merged = [];
    for (let i = 0; perSource.some((l) => l[i]); i++) for (const l of perSource) if (l[i]) merged.push(l[i]);

    const kept = [];
    for (const item of merged) {
      const tk = tokens(item.title);
      const dup = kept.find((k) => similarity(k._tk, tk) >= 0.6);
      if (dup) {
        if (!dup.image && item.image) dup.image = item.image;
        continue;
      }
      kept.push({ ...item, _tk: tk });
      if (kept.length >= 30) break;
    }
    const items = kept.map(({ _tk, ...rest }) => rest);
    items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return { items: items.slice(0, 20) };
  }
}
