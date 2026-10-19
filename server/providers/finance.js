import { fetchJson, settleAll } from '../lib/http.js';

const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

/**
 * Market quotes from Yahoo Finance's public chart endpoint (no key): stocks, indices
 * (^IBEX, ^GSPC), crypto (BTC-USD) and FX (EURUSD=X). Includes an intraday series for sparklines.
 */
export class FinanceProvider {
  /** @param {() => string[]} symbols  read on every refresh (editable in Settings) */
  constructor(symbols) {
    this.symbols = symbols;
  }

  /** Symbol search for the Settings screen (stocks, ETFs, indices, crypto, FX, futures). */
  async search(q, lang = 'en') {
    const d = await fetchJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&lang=${lang}`);
    return (d.quotes || [])
      .filter((x) => x.symbol && x.quoteType !== 'OPTION')
      .map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, type: x.quoteType, exchange: x.exchDisp || x.exchange || '' }));
  }

  async quote(symbol) {
    const d = await fetchJson(`${CHART}/${encodeURIComponent(symbol)}?range=1d&interval=5m`);
    const r = d?.chart?.result?.[0];
    if (!r) throw new Error(`no data for ${symbol}`);
    const m = r.meta;
    const closes = (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
    // Downsample to ≤ 48 points: plenty for a sparkline, light for the Surface.
    const step = Math.max(1, Math.ceil(closes.length / 48));
    const spark = closes.filter((_, i) => i % step === 0 || i === closes.length - 1);
    const prev = m.chartPreviousClose ?? m.previousClose ?? closes[0];
    const price = m.regularMarketPrice ?? closes.at(-1);
    const now = Date.now() / 1000;
    const period = m.currentTradingPeriod?.regular;
    return {
      symbol,
      // Yahoo truncates some short names ("INDUSTRIA DE DISE...O T..."): use the long one then.
      name: (m.shortName && !m.shortName.includes('...') ? m.shortName : m.longName || m.shortName || symbol).replace(/,? (S\.A\.|Inc\.|Corporation|plc)$/i, ''),
      currency: m.currency || '',
      price,
      prevClose: prev,
      change: price - prev,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      open: period ? now >= period.start && now <= period.end : false,
      time: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
      spark,
    };
  }

  async fetch() {
    const symbols = this.symbols();
    if (!symbols.length) return { quotes: [] };
    const results = await settleAll(symbols.map((s) => () => this.quote(s)), 4);
    const quotes = results.filter(Boolean);
    if (!quotes.length) throw new Error('no quotes could be fetched');
    return { quotes };
  }
}
