// The life map's clock. Time is a fractional year `c`. Every event happens
// somewhere inside its own year: an event in year Y lands in (Y-1, Y], so at
// c = 1856 exactly, everything recorded for 1856 has happened (the scrubber's
// old meaning of "as of 1856"), and playing from 1855 to 1856 animates 1856's
// events in order. The year shown on screen is ceil(c).

import { arc, cumulative, km, slice as sliceLine, type LngLat } from './geo';

export type LifeEvent = {
  year: number;
  date?: string;
  between?: [number, number];
  circa?: boolean;
  place: string;
  kind: string;
  certainty?: string;
  source?: string;
  note?: string;
  lat: number | null;
  lon: number | null;
};

export type Person = {
  id: string;
  slug: string;
  name: string;
  branch: string;
  generation: number;
  traced: boolean;
  birthYear: number | null;
  deathYear: number | null;
  events: LifeEvent[];
};

export type Style = 'solid' | 'dash' | 'dot';

/** One leg of a life: from one placed event to the next. */
export type Leg = {
  line: LngLat[];
  cum: number[];
  km: number;
  style: Style;
  /** Time the traveler sets out and arrives. */
  t0: number;
  t1: number;
  /** A crossing (emigrated → arrived): drawn and paced as a voyage. */
  voyage: boolean;
};

export type Placed = LifeEvent & { t: number; pt: LngLat };

export type Timeline = {
  person: Person;
  /** Placed events, time-ordered. */
  placed: Placed[];
  /** Where they live: placed events minus winter homes and burials. */
  homes: Placed[];
  seasonal: Placed[];
  died: Placed | null;
  /** Death-time resting place: the burial, else the place they died. */
  rest: Placed | null;
  legs: Leg[];
  /** Burial journey (dotted), when the body was carried somewhere else. */
  burialLeg: Leg | null;
  /** The whole life's path, birth to burial: the all-years view and the reveal. */
  allLegs: Leg[];
  start: number;
  /** Leave the map at this time with no stone (no death on record). */
  fade: number | null;
};

// No death date on record: leave the map this many years after the first
// event, without a stone, rather than live forever.
export const UNKNOWN_SPAN = 80;
// How long an ordinary move takes on the clock (years, ending at the event).
const TRAVEL = 0.6;

export const soft = (e: { certainty?: string; circa?: boolean }) =>
  e.certainty === 'probable' || e.certainty === 'contested' || !!e.circa;

function dayFraction(date: string, year: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m || Number(m[1]) !== year) return null;
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const at = Date.UTC(year, Number(m[2]) - 1, Number(m[3]));
  return Math.min(1, Math.max(0.001, (at - start) / (end - start)));
}

/**
 * Give each event a time inside its year. Dated events sit on their day.
 * Undated ones keep their list order: spread between their dated neighbours,
 * and a trailing undated run ends exactly at the year's close.
 */
export function eventTimes(events: LifeEvent[]): number[] {
  const t = new Array<number>(events.length);
  let i = 0;
  while (i < events.length) {
    let j = i;
    while (j < events.length && events[j].year === events[i].year) j++;
    const y = events[i].year;
    const f: (number | null)[] = [];
    for (let k = i; k < j; k++) f.push(dayFraction(events[k].date || '', y));
    let k = 0;
    while (k < f.length) {
      if (f[k] != null) { k++; continue; }
      let r = k;
      while (r < f.length && f[r] == null) r++;
      const lo = k > 0 ? (f[k - 1] as number) : 0;
      const tail = r >= f.length;
      const hi = tail ? 1 : (f[r] as number);
      const n = r - k;
      for (let q = 0; q < n; q++) {
        f[k + q] = tail ? lo + ((hi - lo) * (q + 1)) / n : lo + ((hi - lo) * (q + 1)) / (n + 1);
      }
      k = r;
    }
    for (let q = 0; q < f.length; q++) t[i + q] = y - 1 + (f[q] as number);
    i = j;
  }
  return t;
}

function makeLeg(a: Placed, b: Placed, style: Style, voyage: boolean): Leg {
  const line = arc(a.pt, b.pt);
  const cum = cumulative(line);
  const t1 = b.t;
  const t0 = voyage ? Math.min(a.t, t1) : Math.max(a.t, t1 - TRAVEL);
  return { line, cum, km: km(a.pt, b.pt), style, t0, t1, voyage };
}

function legStyle(b: Placed): Style {
  if (b.kind === 'buried') return 'dot';
  return soft(b) ? 'dash' : 'solid';
}

export function buildTimeline(person: Person): Timeline {
  const times = eventTimes(person.events);
  const withT = person.events.map((e, i) => ({ ...e, t: times[i] }));
  const placed: Placed[] = withT
    .filter((e) => e.lat != null && e.lon != null)
    .map((e) => ({ ...e, pt: [e.lon as number, e.lat as number] as LngLat }))
    .sort((a, b) => a.t - b.t);
  const homes = placed.filter((e) => e.kind !== 'buried' && e.kind !== 'seasonal');
  const seasonal = placed.filter((e) => e.kind === 'seasonal');
  const diedEv = withT.find((e) => e.kind === 'died');
  const died = placed.find((e) => e.kind === 'died') || null;
  const buried = placed.filter((e) => e.kind === 'buried').pop() || null;

  const legs: Leg[] = [];
  for (let i = 1; i < homes.length; i++) {
    const a = homes[i - 1];
    const b = homes[i];
    if (a.pt[0] === b.pt[0] && a.pt[1] === b.pt[1]) continue;
    legs.push(makeLeg(a, b, legStyle(b), a.kind === 'emigrated' && b.kind === 'arrived'));
  }
  const lastHome = homes[homes.length - 1] || null;
  let burialLeg: Leg | null = null;
  const deathPlace = died || lastHome;
  if (buried && deathPlace && (buried.pt[0] !== deathPlace.pt[0] || buried.pt[1] !== deathPlace.pt[1])) {
    burialLeg = makeLeg(deathPlace, buried, 'dot', false);
  }

  const allLegs = burialLeg ? [...legs, burialLeg] : legs.slice();

  const bornEv = withT.find((e) => e.kind === 'born');
  const start = bornEv ? bornEv.t : placed.length ? placed[0].t : Infinity;
  const fade = person.deathYear == null && !diedEv ? start + UNKNOWN_SPAN : null;

  return {
    person,
    placed,
    homes,
    seasonal,
    died: diedEv ? (diedEv as Placed) : null,
    rest: buried || died || null,
    legs,
    burialLeg,
    allLegs,
    start,
    fade,
  };
}

export type Mode = 'alive' | 'dead' | 'all';

export type Drawn = { line: LngLat[]; style: Style };

export type State = {
  mode: Mode;
  pos: LngLat;
  /** The event they are at (or the last one they left). */
  at: Placed;
  trail: Drawn[];
  seasonal: Placed | null;
  rest: LngLat | null;
  /** Mid-journey: the leg being traveled right now. */
  moving: Leg | null;
  /** Reached a new home this year. */
  fresh: boolean;
};

function legProgress(leg: Leg, c: number): number {
  if (c >= leg.t1) return 1;
  if (c <= leg.t0) return 0;
  return (c - leg.t0) / (leg.t1 - leg.t0 || 1);
}

/** Where a person stands at time c. null = not on the map then. */
export function stateAt(tl: Timeline, c: number, all: boolean): State | null {
  if (!tl.placed.length) return null;
  if (all) {
    const first = tl.placed[0];
    return {
      mode: 'all',
      pos: first.pt,
      at: first,
      trail: tl.allLegs.map((l) => ({ line: l.line, style: l.style })),
      seasonal: tl.seasonal[tl.seasonal.length - 1] || null,
      rest: tl.rest && tl.died ? tl.rest.pt : null,
      moving: null,
      fresh: false,
    };
  }
  if (c < tl.start) return null;
  const first = tl.homes.length ? tl.homes[0] : tl.placed[0];
  if (first.t > c) return null;
  if (tl.fade != null && c > tl.fade) return null;

  const dead = !!tl.died && tl.died.t <= c;
  const trail: Drawn[] = [];
  let moving: Leg | null = null;
  let pos = first.pt;
  let at: Placed = first;
  for (const leg of tl.legs) {
    const p = legProgress(leg, c);
    if (p <= 0) break;
    if (p >= 1) {
      trail.push({ line: leg.line, style: leg.style });
      pos = leg.line[leg.line.length - 1];
    } else {
      moving = leg;
      const cut = sliceLine(leg.line, leg.cum, p);
      trail.push({ line: cut, style: leg.style });
      pos = cut[cut.length - 1];
      break;
    }
  }
  for (const h of tl.homes) if (h.t <= c) at = h;

  let rest: LngLat | null = null;
  if (dead) {
    if (tl.burialLeg) {
      const p = legProgress(tl.burialLeg, c);
      if (p > 0) {
        const cut = p >= 1 ? tl.burialLeg.line : sliceLine(tl.burialLeg.line, tl.burialLeg.cum, p);
        trail.push({ line: cut, style: 'dot' });
        rest = cut[cut.length - 1];
        if (p < 1) moving = tl.burialLeg;
      } else rest = pos;
    } else rest = tl.rest ? tl.rest.pt : pos;
  }

  const seasonal = dead ? null : tl.seasonal.filter((e) => e.t <= c).pop() || null;
  const label = Math.ceil(c - 1e-9);
  return {
    mode: dead ? 'dead' : 'alive',
    pos: dead && rest ? rest : pos,
    at,
    trail,
    seasonal,
    rest,
    moving,
    fresh: !dead && !moving && at.year === label && at.kind !== 'born',
  };
}


/** The first fraction f of a whole path (by distance), leg styles kept. */
export function partialLegs(legs: Leg[], f: number): Drawn[] {
  if (f >= 1) return legs.map((l) => ({ line: l.line, style: l.style }));
  const total = legs.reduce((s, l) => s + l.cum[l.cum.length - 1], 0);
  let left = total * Math.max(0, f);
  const out: Drawn[] = [];
  for (const l of legs) {
    const len = l.cum[l.cum.length - 1];
    if (left <= 0) break;
    if (left >= len) out.push({ line: l.line, style: l.style });
    else out.push({ line: sliceLine(l.line, l.cum, left / (len || 1)), style: l.style });
    left -= len;
  }
  return out;
}
