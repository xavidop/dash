import { MlbProvider } from './mlb.js';
import { EspnProvider } from './espn.js';
import { EuroleagueProvider } from './euroleague.js';
import { TennisProvider } from './tennis.js';
import { F1Provider } from './f1.js';

/** Provider registry: swap or add sources here (the league catalog's `provider` field picks one). */
export function createSportsProviders() {
  return {
    mlb: new MlbProvider(),
    espn: new EspnProvider(),
    euroleague: new EuroleagueProvider(),
    tennis: new TennisProvider(),
    f1: new F1Provider(),
  };
}
