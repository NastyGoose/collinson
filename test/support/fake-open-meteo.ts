import {
  NO_MATCH,
  PENICHE_PT,
  resultsBody,
  SPRINGFIELD_IL,
  SPRINGFIELD_MA,
  SPRINGFIELD_MO,
  WARSAW_PL,
} from '../fixtures/open-meteo-geocoding';
import { atmosphericBody, marineBody } from '../fixtures/open-meteo-weather';
import { fixtureFetch, jsonResponse } from './fixture-fetch';

/** Peniche (Europe/Lisbon) is UTC+0 in November: its "today" starts at 00:00 UTC. */
export const PENICHE_TODAY = '2026-11-14T00:00:00Z';

type Answer = () => Response | Promise<Response>;

/**
 * Fixture Open-Meteo for all three APIs, routed by host; geocoding by the `name`
 * parameter. Every call is counted, and a request no fixture answers is recorded
 * as a miss, so specs can fail on it instead of reading it as an outage.
 */
export class FakeOpenMeteo {
  geocoding: Record<string, Answer> = {
    peniche: () => jsonResponse(resultsBody(PENICHE_PT)),
    springfield: () => jsonResponse(resultsBody(SPRINGFIELD_MO, SPRINGFIELD_IL, SPRINGFIELD_MA)),
    warsaw: () => jsonResponse(resultsBody(WARSAW_PL)),
    atlantis: () => jsonResponse(NO_MATCH),
  };
  atmospheric: Answer = () => jsonResponse(atmosphericBody({ firstHour: PENICHE_TODAY }));
  marine: Answer = () => jsonResponse(marineBody({ firstHour: PENICHE_TODAY }));
  readonly calls = { geocoding: 0, atmospheric: 0, marine: 0 };
  readonly misses: string[] = [];
  readonly fetch = fixtureFetch((url) => {
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      this.calls.geocoding += 1;
      const answer = this.geocoding[url.searchParams.get('name') ?? ''];
      if (answer !== undefined) {
        return answer();
      }
    } else if (url.hostname === 'api.open-meteo.com') {
      this.calls.atmospheric += 1;
      return this.atmospheric();
    } else if (url.hostname === 'marine-api.open-meteo.com') {
      this.calls.marine += 1;
      return this.marine();
    }
    this.misses.push(url.toString());
    throw new Error(`no fixture for ${url.toString()}`);
  });
}
