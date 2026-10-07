# Life Map — scope

A deep map of the direct line with a year scrubber: drag through time and watch ancestors be born, cross, settle, move, and die, converging toward 1974. Replaces the static `/map`; at "all years" it reads like today's map.

Scoped 2026-10-06. Pattern borrowed from the register year scrubber in `../yonder-site/src/components/maps/ProjectMap.tsx` (`?year=` URL param, last slider stop = "all", things appear at their year and leave at their end year). Built on the site's existing Leaflet, not MapLibre: plain Astro, no React, ~80 people redraw instantly.

## The real work is data

Today the map reads only `birth_place` / `death_place`. Everything in between (census homes, marriages, crossings, moves, burials) lives in the prose bodies. A scrubber over birth→death alone just blinks dots on and off; it pays off when people **move**.

So each person in the reliquary source gets a `life:` list in frontmatter. Edit in the reliquary, re-export, the map updates. No `life:` = fall back to birth/death places, so nobody drops off the map.

### Schema

```yaml
life:
  - { year: 1940, place: "1630 Eastman Avenue, Green Bay, Brown County, Wisconsin", kind: census, source: "1940 census, owned" }
  - { year: 1954, between: [1951, 1957], place: "Point Comfort, Nicolet Drive, Green Bay, Brown County, Wisconsin", kind: moved, certainty: probable }
```

| field | required | meaning |
|---|---|---|
| `year` | yes | integer; the best single year the map uses |
| `date` | no | ISO date when known exactly |
| `between` | no | `[from, to]` window when the year is bracketed (map can fade across it) |
| `circa` | no | `true` when the year is a placeholder with no window |
| `place` | yes | same "Place, County, State" style as `birth_place`; street addresses allowed |
| `kind` | yes | `born · baptized · married · census · residence · moved · seasonal · emigrated · arrived · died · buried` |
| `certainty` | no | `confirmed` (default) · `probable` · `contested` |
| `source` | no | short citation; the full one stays in the body |
| `note` | no | short caveat |

Rules: transcribe, never invent (same as the July birthplace lift). Contested places get two entries both marked `contested`; the map shows both faintly rather than choosing. Use single-line flow maps; values JSON-quoted so the strict build YAML never trips.

## Rendering at year Y

- Each living ancestor sits at their latest event with `year ≤ Y`; their path is drawn up to Y.
- Birth = dot appears. Death = dot becomes a small stone at the `buried` place (or death place).
- `emigrated → arrived` draws the ocean arc. `seasonal` = a faint second home, not a move.
- `probable` = dashed/softer; `contested` = two ghost candidates.
- Color by branch (Krumpos / Coppersmith / Martin / Schmidt from `src/lib/branches.ts`), not 28 surnames.
- Range ~1760–1974 (Foggy's birth); slider snaps to decades with fine drag. "All years" = today's view.
- Click a person → card with their life rail (events as a vertical timeline) + link to `/person/...`.

## Pipeline changes (built 2026-10-06)

Notes from the build: `life:` lines are parsed by a small flow-map parser in `extract-direct-line.py` (system python has no PyYAML); values can be bare words, quoted strings, integers, true/false, [arrays]. The validator lives in the same script and **fails the export** on a bad event. The geocoder retries street addresses without the county segment, and leaves country/state-only places ('Canada', 'Wisconsin') unplotted instead of dropping a dot on the centroid. Branch color comes from the generation-2 grandparent (`rootId` in `src/lib/branches.ts`), carried up the tree. Basemap moved from Carto Voyager (now returns "API key required" everywhere, which broke the old `/map` too) to OSM standard tiles with a sepia CSS filter.

1. `scripts/extract-direct-line.py`: replace the hand-rolled frontmatter parser with PyYAML (it can't read flow maps), emit `life` per ancestor, synthesize `born`/`died` events when `life:` is absent.
2. `scripts/geocode-places.py`: collect places from `life` too. Street addresses go through Nominatim; misses go in `places-overrides.json` as now.
3. Validator script: every `life` event has `year`/`place`/`kind`, `kind` in the vocabulary, years monotonic-ish, `between` brackets `year`. Run it in `pnpm export`.
4. Astro content schema is non-strict, so `life:` passes through the person collection untouched; add it to the schema only when the person page shows the life rail.

## Phases

| | What | Size |
|---|---|---|
| **0 Pilot** ✅ | Schema + `life:` for 9 Coppersmith-line ancestors (74 events). Approved + committed in the reliquary 2026-10-06. | done |
| **1 Scrubber MVP** ✅ built | Pipeline changes above; Leaflet page with scrubber, play, branch toggles, life rail under the map, `?year=` `?person=` `?view=bay` links. Replaced `/map`. | done 2026-10-06 |
| **2 Backfill** | Branch by branch: Claude lifts events from bodies, Foggy approves. Every new census find lands as one `life:` line. | ongoing |
| **3 Depth** | Shifting borders (Bohemia / Austria-Hungary, county lines), era context (1871 fire, immigration waves), historic basemap tiles. | later |

## MapLibre upgrade (built 2026-10-07)

`/map` moved from Leaflet to vanilla MapLibre 6 (no React). Data pipeline untouched. Code lives in `src/lib/lifemap/`: `geo.ts` (great-circle arcs, line slicing), `timeline.ts` (the clock), `motion.ts` (rAF tweens, all instant under reduced motion), `client.ts` (map, playback, UI). Basemap is `public/map/parchment.json`, OpenFreeMap tiles in the site palette, generated by `scripts/build-map-style.py`.

- **Clock:** fractional years. An event in year Y lands inside (Y-1, Y], on its day when dated, else in list order. So `?year=1856` still means "as of the end of 1856", and playing 1855→1856 animates 1856's events. Ordinary moves take 0.6 year on the clock; the crossing runs emigrated→arrived.
- **Playback** slows while anyone visible is on a journey over 150 km, so the 1856 crossing takes about 3 seconds as an arc over the globe. Reduced motion steps whole years.
- **Added:** tilt toggle; tilted swoop on clicking a person; follow-selected camera; fullscreen (rail docks beside the map on wide screens); opening reveal on a bare `/map` (generations ink in oldest first, count rolls up, camera converges on Green Bay; Skip button or any touch ends it; never on deep links or reduced motion).
- **Line styles:** probable/contested legs dashed, burial journeys dotted, resting places as squares (also shown in the all-years view), winter homes as rings.

## Decisions (2026-10-06)

- Direct line only for now; collaterals later if ever.
- Replace `/map` rather than add a second page.
- Run from this repo with `--add-dir ../reliquary` for source edits.

## Pilot review flags (open)

- **Frank & Odile, Nasewaupee:** Frank's body says ~10 years in Nasewaupee, Door County, undated. Odile's says Green Bay from 1905 on. Claude born Dyckesville 1907 contradicts both. Not entered.
- **Celestine's crossing:** body says she emigrated; no year or ship. Not entered (she appears first at her 1871 marriage).
- **Isidore/Frank/Celestine 1900 census:** township not stated in the files; entered as Red River, `probable`.
- **Benson, AZ wintering:** start year unknown; entered `circa` at 1987 so it shows only at the end. A year from the aunts would fix it.
- **Marie → Oregon:** entered 1988 with window 1987–1998.
- **Dorothy's death place:** Oregon, Dane County, WI (Oregon Manor, from obituary) is in `life:` but her `death_place` frontmatter is still empty; lift it.
- **Dorothy after 1947:** no residences yet (Nicolet Drive house is undated). Her married households live on the Krumpos side; pick up in backfill.
- **Alexis & Désirée "Red River ~33 years":** Désirée's body says it; the 1860 and 1880 censuses say Town of Green Bay. Census entered; the obituary's Red River is the parish identity.
- **Baden, Germany** geocodes to a Baden in Lower Saxony, not the Baden region in the southwest (pre-existing). Needs a specific town or an override.
