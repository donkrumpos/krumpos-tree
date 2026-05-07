#!/usr/bin/env python3
"""
Geocode place strings from ancestors.json via OpenStreetMap Nominatim.

Caches results in src/data/places.json keyed by raw place string. Idempotent —
only geocodes places not already in cache. Manual overrides supported via
src/data/places-overrides.json (same shape, takes precedence over cache).

Nominatim usage policy: max 1 request/sec, must set a real User-Agent.
https://operations.osmfoundation.org/policies/nominatim/

Usage:
    python3 scripts/geocode-places.py [--force]
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ANCESTORS_PATH = 'src/data/ancestors.json'
CACHE_PATH = 'src/data/places.json'
OVERRIDES_PATH = 'src/data/places-overrides.json'

USER_AGENT = 'krumpos-tree-genealogy-map/1.0 (https://krumpos.org; contact: anthropic2@fogletter.com)'
NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
RATE_LIMIT_SEC = 1.1  # Slightly over 1s to be safe


def normalize_place(place):
    """Strip parentheticals and collapse whitespace for geocoding queries."""
    if not place:
        return ''
    cleaned = re.sub(r'\s*\([^)]*\)\s*', ' ', place)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().rstrip(',').strip()
    return cleaned


def geocode(query):
    """Hit Nominatim. Returns (lat, lon, display_name) or None."""
    params = urllib.parse.urlencode({
        'q': query,
        'format': 'jsonv2',
        'limit': 1,
        'addressdetails': 0,
    })
    url = f"{NOMINATIM_URL}?{params}"
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return None
    if not data:
        return None
    hit = data[0]
    return {
        'lat': float(hit['lat']),
        'lon': float(hit['lon']),
        'display_name': hit.get('display_name', ''),
    }


def collect_places(ancestors):
    """Return dict: raw_place_string → list of person names using it."""
    places = {}
    for rec in ancestors:
        for field in ('birth_place', 'death_place'):
            raw = rec.get(field, '')
            if not raw:
                continue
            places.setdefault(raw, []).append(f"{rec['name']} ({field})")
    return places


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Re-geocode even cached places')
    parser.add_argument('--ancestors', default=ANCESTORS_PATH)
    parser.add_argument('--cache', default=CACHE_PATH)
    parser.add_argument('--overrides', default=OVERRIDES_PATH)
    args = parser.parse_args()

    if not os.path.isfile(args.ancestors):
        print(f"ERROR: {args.ancestors} not found. Run extract-direct-line.py first.", file=sys.stderr)
        sys.exit(1)

    with open(args.ancestors, 'r', encoding='utf-8') as f:
        ancestors = json.load(f)

    cache = {}
    if os.path.isfile(args.cache):
        with open(args.cache, 'r', encoding='utf-8') as f:
            cache = json.load(f)

    overrides = {}
    if os.path.isfile(args.overrides):
        with open(args.overrides, 'r', encoding='utf-8') as f:
            overrides = json.load(f)

    places = collect_places(ancestors)
    print(f"Found {len(places)} unique places across {len(ancestors)} ancestors")

    new_count = 0
    fail_count = 0
    overridden = 0

    # Process in deterministic order so retries are idempotent
    for raw in sorted(places.keys()):
        users = places[raw]

        if raw in overrides:
            cache[raw] = {**overrides[raw], 'source': 'override'}
            overridden += 1
            continue

        if not args.force and raw in cache and cache[raw].get('source') != 'failed':
            continue

        query = normalize_place(raw)
        if not query:
            continue

        print(f"  Geocoding: {raw}")
        time.sleep(RATE_LIMIT_SEC)
        result = geocode(query)
        if result:
            cache[raw] = {
                'lat': result['lat'],
                'lon': result['lon'],
                'display_name': result['display_name'],
                'query': query,
                'source': 'nominatim',
            }
            new_count += 1
            print(f"    → {result['lat']:.4f}, {result['lon']:.4f}  ({result['display_name'][:80]})")
        else:
            cache[raw] = {
                'lat': None,
                'lon': None,
                'query': query,
                'source': 'failed',
                'note': f"Nominatim returned no results for normalized query: {query}",
            }
            fail_count += 1
            print(f"    → FAILED")

    os.makedirs(os.path.dirname(args.cache), exist_ok=True)
    with open(args.cache, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2, ensure_ascii=False, sort_keys=True)

    print()
    print(f"Cache: {len(cache)} entries written to {args.cache}")
    print(f"  New geocodes: {new_count}")
    print(f"  Failed: {fail_count}")
    print(f"  Overrides applied: {overridden}")
    failed_places = [k for k, v in cache.items() if v.get('source') == 'failed']
    if failed_places:
        print(f"\n  Failed lookups (add to {args.overrides} to fix):")
        for p in failed_places:
            print(f"    - {p}")


if __name__ == '__main__':
    main()
