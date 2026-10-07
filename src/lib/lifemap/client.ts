// The life map (/map), client side. Vanilla MapLibre over the data the page
// embeds as #map-data. Owns: the clock (fractional years), playback, the
// opening reveal, selection swoop, tilt, camera follow, and fullscreen, plus
// the full-bleed chrome that floats over the map (person sheet, about card).

import * as maplibregl from 'maplibre-gl';
// MapLibre 6 loads its worker as a separate ES module at runtime, which Vite
// never sees; `?worker&url` makes Vite emit it as a real asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LngLat } from './geo';
import { reducedMotion, stagger } from './motion';
import {
  buildTimeline,
  partialLegs,
  soft,
  stateAt,
  type Person,
  type State,
  type Timeline,
} from './timeline';

maplibregl.setWorkerUrl(workerUrl);

type MapData = {
  people: Person[];
  branchColor: Record<string, string>;
  branchLabel: Record<string, string>;
  timeMin: number;
  timeAll: number;
};

type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

const STYLE_URL = '/map/parchment.json';
const BAY: [LngLat, LngLat] = [[-88.2, 44.4], [-87.55, 44.75]];
const SWOOP = { pitch: 46, bearing: -14 };
const FOCUS_ZOOM = 11;
// Playback pace in years per second; long journeys slow the clock so a
// crossing reads as a voyage, not a blink.
const BASE_RATE = 7;
const LONG_KM = 150;
const STONE_PX = 9;
// Below this width the person rail is a pull-up sheet, not a side panel.
const WIDE = '(min-width: 900px)';
const INTRO_KEY = 'krumpos.lifemap.intro-seen';

const esc = (s: unknown) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

function lifespan(p: Person): string {
  if (p.birthYear && p.deathYear) return p.birthYear + '–' + p.deathYear;
  if (p.birthYear) return 'b. ' + p.birthYear;
  if (p.deathYear) return 'd. ' + p.deathYear;
  return '';
}

function eventYear(e: Person['events'][number]): string {
  if (e.between) return e.between[0] + '–' + e.between[1];
  return (e.circa ? 'c. ' : '') + e.year;
}

/** A small square headstone in a branch color, drawn once per branch. */
function stoneImage(color: string): ImageData {
  const ratio = 2;
  const size = STONE_PX * ratio;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#cfc6b8';
  ctx.fillRect(3, 3, size - 6, size - 6);
  return ctx.getImageData(0, 0, size, size);
}

export function mountLifeMap(): void {
  const node = document.getElementById('map-data');
  const mapEl = document.getElementById('ancestor-map');
  if (!node || !mapEl) return;
  const data = JSON.parse(node.textContent || '{}') as MapData;
  const ALL = data.timeAll;
  const RM = reducedMotion();
  const timelines: Timeline[] = data.people.map(buildTimeline);
  const byId = new Map(timelines.map((t) => [t.person.id, t]));

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('lm-stage');
  const slider = $<HTMLInputElement>('lm-slider');
  const yearEl = $('lm-year');
  const statusEl = $('lm-status');
  const playBtn = $<HTMLButtonElement>('lm-play');
  const personEl = $('lm-person');
  const panel = $('lm-panel');
  const handle = $<HTMLButtonElement>('lm-handle');
  const tiltBtn = $<HTMLButtonElement>('lm-tilt');
  const fsBtn = $<HTMLButtonElement>('lm-fs');
  const followBtn = $<HTMLButtonElement>('lm-follow');
  const viewBtn = $<HTMLButtonElement>('lm-view');
  const skipBtn = $<HTMLButtonElement>('lm-skip');
  const tools = $('lm-tools');
  const bar = $('lm-bar');
  const titleCard = $('lm-titlecard');
  const info = $('lm-info');
  const infoBtn = $<HTMLButtonElement>('lm-info-btn');
  const wide = window.matchMedia(WIDE);

  // ── State ──
  let c = Number(slider.value);
  const hidden = new Set<string>();
  let selectedId: string | null = null;
  let ready = false;
  let reveal: Map<string, number> | null = null;
  let finishReveal: (() => void) | null = null;
  let revealCount: number | null = null;
  let lastUrlYear: number | null = null;
  let following = false;

  const allBounds = new maplibregl.LngLatBounds();
  timelines.forEach((t) => t.placed.forEach((e) => allBounds.extend(e.pt)));

  const params = new URLSearchParams(window.location.search);
  const qYear = Number(params.get('year'));
  if (qYear) c = Math.min(ALL, Math.max(data.timeMin, qYear));
  if (params.get('person')) selectedId = params.get('person');
  const startBay = params.get('view') === 'bay';
  const deepLinked = params.has('year') || params.has('person') || params.has('view');
  slider.value = String(c);

  const map = new maplibregl.Map({
    container: mapEl,
    style: STYLE_URL,
    bounds: startBay ? BAY : allBounds,
    fitBoundsOptions: { padding: 30 },
    maxPitch: 60,
    attributionControl: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  // Zoom and compass join the icon column instead of a map corner.
  tools.append(new maplibregl.NavigationControl({ visualizePitch: true }).onAdd(map));
  map.on('error', (e) => console.error('[lifemap]', e.error?.message ?? e));
  map.on('styleimagemissing', (e) => {
    if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  new ResizeObserver(() => map.resize()).observe(mapEl);
  // Compact attribution starts folded to its (i) so it never covers a phone map.
  map.once('idle', () => mapEl.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));

  // ── Overlay insets: camera fits and swoops land in the part of the map
  // the floating cards leave clear ──
  function insets(): maplibregl.PaddingOptions {
    const W = mapEl.clientWidth;
    const H = mapEl.clientHeight;
    const isWide = wide.matches;
    const top = titleCard.getBoundingClientRect().bottom;
    let bottomEdge = bar.getBoundingClientRect().top;
    let right = 0;
    if (!panel.hidden) {
      const r = panel.getBoundingClientRect();
      if (isWide) right = W - r.left;
      else if (!panel.classList.contains('lm-open')) bottomEdge = Math.min(bottomEdge, r.top);
    }
    if (isWide && !right) right = W - tools.getBoundingClientRect().left;
    const bottom = Math.max(0, H - bottomEdge);
    // Never let the cards squeeze the open map below 40% of either side.
    const v = (top + bottom) / Math.max(1, H * 0.6);
    const h = right / Math.max(1, W * 0.6);
    const pad = {
      top: Math.round(v > 1 ? top / v : top),
      bottom: Math.round(v > 1 ? bottom / v : bottom),
      right: Math.round(h > 1 ? right / h : right),
      left: 0,
    };
    return pad;
  }
  let padPending = false;
  function syncPadding() {
    // setPadding is a jumpTo, which would cut a swoop or fit short; wait it out.
    if (map.isMoving()) {
      if (!padPending) { padPending = true; map.once('moveend', () => { padPending = false; syncPadding(); }); }
      return;
    }
    const p = insets();
    const now = map.getPadding();
    if (p.top !== now.top || p.bottom !== now.bottom || p.right !== now.right || p.left !== now.left) map.setPadding(p);
  }
  function syncChrome() {
    stage.style.setProperty('--lm-bar-h', bar.offsetHeight + 'px');
    stage.style.setProperty('--lm-top-h', titleCard.offsetHeight + 'px');
    syncPadding();
  }
  const chromeObserver = new ResizeObserver(syncChrome);
  [bar, titleCard, panel, mapEl].forEach((el) => chromeObserver.observe(el));
  syncChrome();
  map.fitBounds(startBay ? BAY : allBounds, { padding: 30, duration: 0 });

  const fitAll = (instant = false) =>
    map.fitBounds(allBounds, { padding: 30, duration: instant || RM ? 0 : 1200 });
  const fitBay = (instant = false) =>
    map.fitBounds(BAY, { padding: 20, duration: instant || RM ? 0 : 1200 });

  // ── Layers ──
  // Layers hang off 'style.load' (the style is processed) rather than 'load'
  // (every tile rendered), so the data shows before the basemap finishes.
  map.on('style.load', () => {
    for (const [branch, color] of Object.entries(data.branchColor)) {
      if (!map.hasImage('stone-' + branch)) map.addImage('stone-' + branch, stoneImage(color), { pixelRatio: 2 });
    }
    map.addSource('lm-trails', { type: 'geojson', data: empty() });
    map.addSource('lm-points', { type: 'geojson', data: empty() });
    const linePaint = {
      'line-color': ['get', 'color'],
      'line-width': ['get', 'w'],
      'line-opacity': ['get', 'o'],
    } as const;
    map.addLayer({
      id: 'lm-trail-solid', type: 'line', source: 'lm-trails',
      filter: ['==', ['get', 'style'], 'solid'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { ...linePaint } as never,
    });
    map.addLayer({
      id: 'lm-trail-dash', type: 'line', source: 'lm-trails',
      filter: ['==', ['get', 'style'], 'dash'],
      layout: { 'line-join': 'round' },
      paint: { ...linePaint, 'line-dasharray': [3, 2.5] } as never,
    });
    map.addLayer({
      id: 'lm-trail-dot', type: 'line', source: 'lm-trails',
      filter: ['==', ['get', 'style'], 'dot'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { ...linePaint, 'line-dasharray': [0.1, 2.6] } as never,
    });
    map.addLayer({
      id: 'lm-rings', type: 'circle', source: 'lm-points',
      filter: ['==', ['get', 'kind'], 'ring'],
      paint: {
        'circle-radius': 7,
        'circle-opacity': 0,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': ['get', 'o'],
        'circle-pitch-alignment': 'map',
      },
    });
    map.addLayer({
      id: 'lm-stones', type: 'symbol', source: 'lm-points',
      filter: ['==', ['get', 'kind'], 'stone'],
      layout: {
        'icon-image': ['concat', 'stone-', ['get', 'branch']],
        'icon-size': ['get', 'size'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'z'],
      },
      paint: { 'icon-opacity': ['get', 'o'] },
    });
    map.addLayer({
      id: 'lm-dots', type: 'circle', source: 'lm-points',
      filter: ['==', ['get', 'kind'], 'dot'],
      layout: { 'circle-sort-key': ['get', 'z'] },
      paint: {
        'circle-radius': ['get', 'r'],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['get', 'fo'],
        'circle-stroke-color': ['get', 'stroke'],
        'circle-stroke-width': ['get', 'sw'],
        'circle-stroke-opacity': ['get', 'o'],
      },
    });

    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'lm-tip' });
    for (const layer of ['lm-dots', 'lm-stones']) {
      map.on('mousemove', layer, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = 'pointer';
        tip.setLngLat((f.geometry as GeoJSON.Point).coordinates as LngLat)
          .setHTML(esc(f.properties.name) + ' <span style="color:#9a918a">' + esc(f.properties.life) + '</span>')
          .addTo(map);
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
        tip.remove();
      });
      map.on('click', layer, (e) => {
        const f = e.features?.[0];
        if (f) select(String(f.properties.id), true);
      });
    }

    ready = true;
    if (!deepLinked && !RM) startReveal();
    else render();
  });

  // ── Render ──
  function stateFor(tl: Timeline): State | null {
    if (reveal) {
      const f = reveal.get(tl.person.id) || 0;
      if (f <= 0) return null;
      const s = stateAt(tl, ALL, true);
      if (!s) return null;
      s.trail = partialLegs(tl.allLegs, f);
      if (f < 1) { s.rest = null; s.seasonal = null; }
      return s;
    }
    return stateAt(tl, c, c >= ALL);
  }

  function render() {
    if (!ready) return;
    const all = c >= ALL;
    const label = Math.ceil(c - 1e-9);
    const trails: Feature[] = [];
    const points: Feature[] = [];
    let living = 0;
    const placesNow = new Set<string>();
    let followAt: LngLat | null = null;

    for (const tl of timelines) {
      const p = tl.person;
      if (hidden.has(p.branch)) continue;
      const s = stateFor(tl);
      if (!s) continue;
      const color = data.branchColor[p.branch] || '#666';
      const chosen = p.id === selectedId;
      const faint = s.mode !== 'alive';
      const z = chosen ? 2 : s.mode === 'alive' ? 1 : 0;
      const base = { id: p.id, name: p.name, life: lifespan(p), color, branch: p.branch, z };

      for (const d of s.trail) {
        if (d.line.length < 2) continue;
        trails.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: d.line },
          properties: { color, style: d.style, w: chosen ? 3 : 1.8, o: chosen ? 0.9 : faint ? 0.3 : 0.6 },
        });
      }
      if (s.seasonal) {
        points.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: s.seasonal.pt },
          properties: { ...base, kind: 'ring', o: chosen ? 0.95 : 0.7 },
        });
      }
      const stone = (pt: LngLat, o: number) =>
        points.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: pt },
          properties: { ...base, kind: 'stone', o, size: chosen ? 1.3 : 1 },
        });
      if (s.mode === 'dead') {
        stone(s.pos, chosen ? 1 : 0.75);
      } else {
        if (s.mode === 'alive') { living++; placesNow.add(s.at.place); }
        if (s.mode === 'all' && s.rest) stone(s.rest, chosen ? 0.95 : 0.55);
        const grow = reveal ? Math.min(1, (reveal.get(p.id) || 0) * 4) : 1;
        points.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: s.pos },
          properties: {
            ...base,
            kind: 'dot',
            r: (chosen ? 9 : s.fresh ? 8 : 6) * grow,
            stroke: chosen ? '#000' : '#3d2e1e',
            sw: chosen ? 2 : 1,
            o: 1,
            fo: soft(s.at) ? 0.45 : s.mode === 'all' ? 0.75 : 0.9,
          },
        });
      }
      if (chosen) followAt = s.pos;
    }

    (map.getSource('lm-trails') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: trails });
    (map.getSource('lm-points') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: points });

    if (all) {
      yearEl.textContent = 'All years';
      statusEl.textContent = revealCount != null
        ? revealCount + (revealCount === 1 ? ' ancestor' : ' ancestors')
        : 'Each dot is a birthplace; lines follow the life.';
    } else {
      yearEl.textContent = String(label);
      statusEl.textContent = living
        ? living + ' living ' + (living === 1 ? 'ancestor' : 'ancestors') + ' · ' + placesNow.size + (placesNow.size === 1 ? ' place' : ' places')
        : 'No living ancestors on the map yet';
    }
    renderPerson(all ? ALL : label);
    if (followAt && following && !reveal) map.jumpTo({ center: followAt });
  }

  function renderPerson(Y: number) {
    const tl = selectedId ? byId.get(selectedId) : null;
    if (!tl) {
      if (!panel.hidden) { panel.hidden = true; setSheet(false); }
      personEl.innerHTML = '';
      return;
    }
    const p = tl.person;
    const rows = p.events.map((e) => {
      const future = Y < ALL && e.year > Y;
      return '<li class="flex gap-3 py-1 ' + (future ? 'opacity-40' : '') + '">' +
        '<span class="w-20 sm:w-24 shrink-0 tabular-nums text-[var(--color-warm-gray)]">' + esc(eventYear(e)) + '</span>' +
        '<span><span class="font-semibold">' + esc(e.kind) + '</span> · ' + esc(e.place) +
        (soft(e) ? ' <em class="text-[var(--color-muted)]">(' + esc(e.certainty || 'approximate') + ')</em>' : '') +
        (e.source ? '<span class="block text-xs text-[var(--color-muted)]">' + esc(e.source) + '</span>' : '') +
        (e.note ? '<span class="block text-xs text-[var(--color-muted)]">' + esc(e.note) + '</span>' : '') +
        '</span></li>';
    }).join('');
    personEl.innerHTML =
      '<div class="flex items-start justify-between gap-3">' +
        '<h2>' + esc(p.name) + '</h2>' +
        '<button type="button" id="lm-close" class="lm-close" aria-label="Close">✕</button>' +
      '</div>' +
      '<p class="text-sm text-[var(--color-warm-gray)] mb-2">' + esc(lifespan(p)) + ' · ' +
        esc(data.branchLabel[p.branch] || p.branch) + ' line · generation ' + p.generation +
        (p.traced ? '' : ' · <em>birth and death only so far</em>') + '</p>' +
      '<ol class="text-sm border-l-2 pl-3" style="border-color:' + data.branchColor[p.branch] + '">' + rows + '</ol>' +
      '<a class="inline-block mt-3 text-sm" href="/person/' + esc(p.slug) + '/">View the full record →</a>';
    panel.hidden = false;
    $('lm-close').onclick = () => select(null, false);
  }

  function syncUrl(force = false) {
    const Y = c >= ALL ? null : Math.ceil(c - 1e-9);
    if (!force && Y === lastUrlYear) return;
    lastUrlYear = Y;
    const u = new URL(window.location.href);
    if (Y == null) u.searchParams.delete('year'); else u.searchParams.set('year', String(Y));
    if (selectedId) u.searchParams.set('person', selectedId); else u.searchParams.delete('person');
    history.replaceState(null, '', u);
  }

  // ── Selection: the tilted swoop ──
  function select(id: string | null, swoop: boolean) {
    finishReveal?.();
    const changed = id !== selectedId;
    selectedId = id;
    followBtn.disabled = !id;
    if (!id) setFollow(false);
    // A new person opens the sheet at its peek, so the swoop stays in view.
    if (changed) setSheet(false);
    render();
    syncUrl(true);
    syncPadding();
    if (!id || !swoop) return;
    const tl = byId.get(id);
    const s = tl && stateAt(tl, c, c >= ALL);
    if (!s) return;
    const target = { center: s.pos, zoom: Math.max(map.getZoom(), FOCUS_ZOOM), ...SWOOP };
    if (RM) map.jumpTo(target);
    else map.flyTo({ ...target, duration: 2000, curve: 1.5, essential: true });
  }

  // ── Tilt ──
  const syncTilt = () => tiltBtn.setAttribute('aria-pressed', String(map.getPitch() > 5));
  map.on('pitchend', syncTilt);
  tiltBtn.addEventListener('click', () => {
    const tilted = map.getPitch() > 5;
    map.easeTo({ ...(tilted ? { pitch: 0, bearing: 0 } : SWOOP), duration: RM ? 0 : 900 });
  });

  // ── Follow: dragging the map hands the camera back ──
  function setFollow(on: boolean) {
    following = on;
    followBtn.setAttribute('aria-pressed', String(on));
  }
  followBtn.disabled = !selectedId;
  map.on('dragstart', (e) => { if ((e as { originalEvent?: Event }).originalEvent) setFollow(false); });
  followBtn.addEventListener('click', () => { setFollow(!following); render(); });

  // ── Fullscreen: the page is already full-bleed; this drops the browser
  // chrome too. Hidden where the browser can't (iPhone Safari). ──
  fsBtn.hidden = !(document.fullscreenEnabled && stage.requestFullscreen);
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    fsBtn.title = on ? 'Exit fullscreen' : 'Fullscreen';
  });

  // ── Person sheet (phones): peek shows the name, pulled up shows the rail ──
  function setSheet(open: boolean) {
    panel.classList.toggle('lm-open', open);
    handle.setAttribute('aria-expanded', String(open));
    handle.setAttribute('aria-label', open ? 'Show less' : 'Show the whole life');
    if (!open) personEl.scrollTop = 0;
  }
  handle.addEventListener('click', () => setSheet(!panel.classList.contains('lm-open')));
  // Tapping the peeking name pulls the sheet up too.
  personEl.addEventListener('click', (e) => {
    if (wide.matches || panel.classList.contains('lm-open')) return;
    if ((e.target as HTMLElement).closest('a, button')) return;
    setSheet(true);
  });
  // Swipe on the handle or the peek: up opens, down closes.
  let swipeY: number | null = null;
  panel.addEventListener('pointerdown', (e) => {
    if (wide.matches) return;
    const fromHandle = handle.contains(e.target as Node);
    if (fromHandle || !panel.classList.contains('lm-open') || personEl.scrollTop <= 0) swipeY = e.clientY;
  });
  panel.addEventListener('pointerup', (e) => {
    if (swipeY == null) return;
    const dy = e.clientY - swipeY;
    swipeY = null;
    if (dy < -24) setSheet(true);
    else if (dy > 40) setSheet(false);
  });
  panel.addEventListener('pointercancel', () => { swipeY = null; });
  wide.addEventListener('change', () => syncPadding());

  // ── About card: opens once per browser, reopens from ⓘ ──
  function setInfo(open: boolean) {
    info.hidden = !open;
    infoBtn.setAttribute('aria-expanded', String(open));
  }
  infoBtn.addEventListener('click', () => setInfo(info.hidden));
  for (const id of ['lm-info-close', 'lm-info-x']) $(id).addEventListener('click', () => { setInfo(false); infoBtn.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !info.hidden) setInfo(false); });
  let introSeen = false;
  try { introSeen = localStorage.getItem(INTRO_KEY) === '1'; } catch { /* storage blocked: show it */ }
  if (!introSeen) {
    setInfo(true);
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* fine, it just shows again */ }
  }

  // ── Playback ──
  let raf = 0;
  let last = 0;
  let stepAcc = 0;
  const playing = () => raf !== 0;

  /** Years per second right now: slow down while anyone visible is on a long road. */
  function pace(at: number, dt: number): number {
    let rate = BASE_RATE;
    let next = Infinity;
    for (const tl of timelines) {
      if (hidden.has(tl.person.branch)) continue;
      const legs = tl.burialLeg ? [...tl.legs, tl.burialLeg] : tl.legs;
      for (const leg of legs) {
        if (leg.km < LONG_KM) continue;
        if (leg.t0 <= at && at < leg.t1) {
          const ms = Math.min(3200, Math.max(700, 500 + leg.km * 0.45));
          rate = Math.min(rate, (leg.t1 - leg.t0) / (ms / 1000));
        } else if (leg.t0 > at) next = Math.min(next, leg.t0);
      }
    }
    // Never step clean over the start of a long journey.
    const step = rate * dt;
    return at + step > next ? (next - at) / (dt || 1) : rate;
  }

  const playIc = playBtn.querySelector('.lm-play-ic')!;
  const playLabel = playBtn.querySelector('.lm-play-label')!;
  function setPlayUi(on: boolean) {
    playIc.textContent = on ? '❚❚' : '▶';
    playLabel.textContent = on ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play through the years');
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    setPlayUi(false);
  }

  function tick(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const end = ALL - 1;
    if (RM) {
      // Reduced motion: whole-year steps, the old cadence.
      stepAcc += dt;
      if (stepAcc >= 0.14) { stepAcc = 0; c = Math.floor(c) + 1; }
    } else {
      c += pace(c, dt) * dt;
    }
    if (c >= end) c = end;
    slider.value = String(Math.ceil(c - 1e-9));
    render();
    syncUrl();
    if (c >= end) { stop(); return; }
    raf = requestAnimationFrame(tick);
  }

  playBtn.addEventListener('click', () => {
    finishReveal?.();
    if (playing()) { stop(); return; }
    if (c >= ALL - 1) c = data.timeMin;
    setPlayUi(true);
    last = performance.now();
    stepAcc = 0;
    raf = requestAnimationFrame(tick);
  });

  slider.addEventListener('input', () => {
    finishReveal?.();
    stop();
    c = Number(slider.value);
    render();
    syncUrl();
  });

  document.querySelectorAll<HTMLButtonElement>('.lm-branch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = btn.getAttribute('data-branch') || '';
      if (hidden.has(b)) hidden.delete(b); else hidden.add(b);
      btn.setAttribute('aria-pressed', String(!hidden.has(b)));
      render();
    });
  });
  // One toggle between the whole map and the Green Bay frame; its icon shows
  // where it goes next.
  function setView(v: 'all' | 'bay') {
    viewBtn.dataset.view = v;
    const label = v === 'bay' ? 'Show the whole map' : 'Zoom to Green Bay';
    viewBtn.setAttribute('aria-label', label);
    viewBtn.title = v === 'bay' ? 'Whole map' : 'Green Bay';
  }
  setView(startBay ? 'bay' : 'all');
  viewBtn.addEventListener('click', () => {
    finishReveal?.();
    if (viewBtn.dataset.view === 'bay') { fitAll(); setView('all'); }
    else { fitBay(); setView('bay'); }
  });

  // ── Opening reveal: generations ink in oldest first, converging on Green Bay ──
  function startReveal() {
    const gens = [...new Set(timelines.map((t) => t.person.generation))].sort((a, b) => b - a);
    const members = gens.map((g) => timelines.filter((t) => t.person.generation === g));
    reveal = new Map(timelines.map((t) => [t.person.id, 0]));
    revealCount = 0;
    skipBtn.hidden = false;
    let flown = false;
    const bayFrom = gens.findIndex((g) => g <= 3);

    const stopOnTouch = () => finishReveal?.();
    const canvas = map.getCanvasContainer();
    canvas.addEventListener('pointerdown', stopOnTouch, { once: true });
    canvas.addEventListener('wheel', stopOnTouch, { once: true, passive: true });

    const done = () => {
      reveal = null;
      revealCount = null;
      finishReveal = null;
      skipBtn.hidden = true;
      canvas.removeEventListener('pointerdown', stopOnTouch);
      canvas.removeEventListener('wheel', stopOnTouch);
      render();
    };

    const finish = stagger(
      gens.length,
      { stagger: 480, duration: 1300 },
      (progress) => {
        let count = 0;
        progress.forEach((p, i) => {
          for (const t of members[i]) reveal!.set(t.person.id, p);
          count += members[i].length * Math.min(1, p * 1.6);
        });
        revealCount = Math.round(count);
        if (!flown && bayFrom >= 0 && progress[bayFrom] > 0) {
          flown = true;
          setView('bay');
          map.fitBounds(BAY, { padding: 20, duration: 2600, essential: true });
        }
        render();
      },
      done,
    );
    // Skipping inks everything at once and leaves the camera where it is;
    // the Skip button also lands on the Green Bay frame.
    finishReveal = finish;
  }
  skipBtn.addEventListener('click', () => {
    finishReveal?.();
    fitBay(true);
    setView('bay');
  });
}
