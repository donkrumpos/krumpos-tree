#!/usr/bin/env python3
"""
Walk up the parents chain from Foggy's record, emit src/data/ancestors.json.

Reads SOURCE data directly from reliquary so the map data is independent of the
export pipeline (which has a name-resolution bug for "first middle maiden" forms
like 'Dorothy Elaine Coppersmith' → 'Dorothy Elaine (Coppersmith) Krumpos').

Usage:
    python3 scripts/extract-direct-line.py [--root donald-a-krumpos]
"""

import argparse
import json
import os
import re
import sys
from collections import deque

ROOT_ID = 'donald-a-krumpos'
DEFAULT_SOURCE = os.path.expanduser(
    '~/Documents/active_projects_local/reliquary/corpus/memoir/notes/family-tree/people'
)
OUTPUT_PATH = 'src/data/ancestors.json'


def parse_frontmatter(text):
    """Minimal frontmatter parser — handles inline lists and block lists."""
    lines = text.split('\n')
    if not lines or lines[0].strip() != '---':
        return {}
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            end = i
            break
    if end == -1:
        return {}

    data = {}
    current_list = None

    for line in lines[1:end]:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        if stripped.startswith('- ') and current_list is not None:
            val = stripped[2:].strip().strip("'\"")
            current_list.append(val)
            continue

        match = re.match(r'^(\w[\w_]*):\s*(.*)', line)
        if match:
            key = match.group(1)
            val = match.group(2).strip()

            if val == '' or val == '[]':
                data[key] = []
                current_list = data[key]
            elif val.startswith('[') and val.endswith(']'):
                # Inline list — split on commas, respecting quoted segments
                inner = val[1:-1]
                items = re.findall(r'"([^"]*)"|\'([^\']*)\'|([^,]+)', inner)
                data[key] = [
                    next((g for g in m if g), '').strip().strip("'\"")
                    for m in items
                ]
                data[key] = [v for v in data[key] if v]
                current_list = None
            else:
                data[key] = val.strip("'\"")
                current_list = None

    return data


def normalize_name(name):
    """Lowercase, strip parentheticals and punctuation, collapse whitespace."""
    if not name:
        return ''
    name = re.sub(r'\(.*?\)', ' ', name)
    name = re.sub(r"[''`]", '', name)
    name = re.sub(r'\s*\(m\..*?\)\s*', ' ', name)  # marriage annotations
    name = re.sub(r'[^\w\s-]', ' ', name, flags=re.UNICODE)
    name = re.sub(r'\s+', ' ', name).strip().lower()
    return name


def name_variants(name):
    """Generate lookup variants for a person's name field.

    For 'Dorothy Elaine (Coppersmith) Krumpos', emit:
      - 'dorothy elaine coppersmith krumpos' (full normalized)
      - 'dorothy elaine coppersmith' (first + middle + maiden)
      - 'dorothy coppersmith' (first + maiden)
      - 'dorothy krumpos' (first + last)
      - 'dorothy elaine krumpos' (first + middle + last)
    """
    variants = set()
    if not name:
        return variants

    # Extract maiden from parentheses
    paren_match = re.search(r'\(([^)]+)\)', name)
    maiden = paren_match.group(1).strip() if paren_match else None

    cleaned = re.sub(r'\([^)]*\)', ' ', name)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    parts = cleaned.split()
    parts_lower = [p.lower() for p in parts]

    # Full form
    if maiden:
        with_maiden = parts + [maiden]
        variants.add(' '.join(p.lower() for p in with_maiden))
    if parts:
        variants.add(' '.join(parts_lower))
        # First + last
        if len(parts) >= 2:
            variants.add(f"{parts_lower[0]} {parts_lower[-1]}")
        # First + middle + last
        if len(parts) >= 3:
            variants.add(' '.join(parts_lower))
        # First + maiden
        if maiden and len(parts) >= 1:
            variants.add(f"{parts_lower[0]} {maiden.lower()}")
        # First + middle + maiden
        if maiden and len(parts) >= 2:
            variants.add(f"{parts_lower[0]} {parts_lower[1]} {maiden.lower()}")

    return {v for v in variants if v}


def build_indexes(people_dir):
    """Build id→path and name-variant→path indexes from source files."""
    by_id = {}
    by_name = {}
    all_files = []

    for surname in sorted(os.listdir(people_dir)):
        spath = os.path.join(people_dir, surname)
        if not os.path.isdir(spath) or surname.startswith('.'):
            continue
        for fname in sorted(os.listdir(spath)):
            if not fname.endswith('.md') or fname.endswith('.bak'):
                continue
            fpath = os.path.join(spath, fname)
            with open(fpath, 'r', encoding='utf-8') as f:
                data = parse_frontmatter(f.read())

            person_id = data.get('id', fname[:-3])
            if person_id and person_id not in by_id:
                by_id[person_id] = (fpath, surname, data)

            for variant in name_variants(data.get('name', '')):
                # First-write-wins so the canonical record beats homonyms.
                # Could log collisions later if it matters.
                by_name.setdefault(variant, (fpath, surname, data))

            for aka in data.get('aka', []) or []:
                for variant in name_variants(aka):
                    by_name.setdefault(variant, (fpath, surname, data))

            all_files.append((fpath, surname, data))

    return by_id, by_name


def resolve_parent(parent_ref, by_id, by_name):
    """Match a parent reference (like 'Keith Lester Krumpos') to a (path, surname, data)."""
    if not parent_ref:
        return None
    norm = normalize_name(parent_ref)
    if not norm:
        return None
    # Try full normalized
    if norm in by_name:
        return by_name[norm]
    # Try without middle: drop middle tokens, keep first + last
    parts = norm.split()
    if len(parts) >= 2:
        first_last = f"{parts[0]} {parts[-1]}"
        if first_last in by_name:
            return by_name[first_last]
    return None


def walk_ancestors(people_dir, root_id):
    by_id, by_name = build_indexes(people_dir)

    if root_id not in by_id:
        print(f"ERROR: id={root_id} not found in {people_dir}", file=sys.stderr)
        sys.exit(1)

    ancestors = {}  # path → record
    queue = deque([(by_id[root_id], 0)])
    visited = set()
    chain_breaks = []

    while queue:
        (fpath, surname, data), gen = queue.popleft()
        if fpath in visited:
            continue
        visited.add(fpath)

        if not data.get('name'):
            continue

        ancestors[fpath] = {
            'id': data.get('id', os.path.basename(fpath)[:-3]),
            'slug': f"{surname}/{data.get('id', os.path.basename(fpath)[:-3])}",
            'name': data['name'],
            'surname': surname,
            'birth': str(data.get('birth', '') or ''),
            'death': str(data.get('death', '') or ''),
            'birth_place': data.get('birth_place', ''),
            'death_place': data.get('death_place', ''),
            'generation': gen,
            'gender': data.get('gender', ''),
        }

        for parent_ref in (data.get('parents') or []):
            if not parent_ref:
                continue
            resolved = resolve_parent(parent_ref, by_id, by_name)
            if resolved:
                if resolved[0] not in visited:
                    queue.append((resolved, gen + 1))
            else:
                chain_breaks.append((data['name'], parent_ref))

    return ancestors, chain_breaks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=ROOT_ID)
    parser.add_argument('--source', default=DEFAULT_SOURCE)
    parser.add_argument('--output', default=OUTPUT_PATH)
    args = parser.parse_args()

    if not os.path.isdir(args.source):
        print(f"ERROR: {args.source} not found", file=sys.stderr)
        sys.exit(1)

    ancestors, chain_breaks = walk_ancestors(args.source, args.root)

    by_gen = {}
    with_birthplace = 0
    countries = set()
    for rec in ancestors.values():
        by_gen[rec['generation']] = by_gen.get(rec['generation'], 0) + 1
        if rec['birth_place']:
            with_birthplace += 1
            country = re.sub(r'\s*\([^)]*\)\s*', '', rec['birth_place']).split(',')[-1].strip()
            if country:
                countries.add(country)

    sorted_records = sorted(
        ancestors.values(),
        key=lambda r: (r['generation'], r['surname'], r['name'])
    )

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(sorted_records, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(sorted_records)} ancestors to {args.output}")
    print(f"  By generation: {dict(sorted(by_gen.items()))}")
    print(f"  With birthplace: {with_birthplace}/{len(sorted_records)}")
    if countries:
        print(f"  Countries: {sorted(countries)}")
    if chain_breaks:
        print(f"  Chain breaks: {len(chain_breaks)}")
        for name, parent in chain_breaks[:15]:
            print(f"    {name}  →  {parent}")


if __name__ == '__main__':
    main()
