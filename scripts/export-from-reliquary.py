#!/usr/bin/env python3
"""
Export genealogy data from reliquary into krumpos-tree Astro content collections.

One-way pipeline: reliquary/corpus/memoir/notes/family-tree → krumpos-tree/src/content/
Re-runnable and idempotent. Overwrites destination.

Usage:
    python scripts/export-from-reliquary.py \
        --source ~/Documents/active_projects_local/reliquary/corpus/memoir/notes/family-tree \
        --dest .
"""

import argparse
import os
import re
import shutil
import sys
import unicodedata

# Try to import yaml; fall back to a simple parser if not available
try:
    import yaml

    class SafeQuoteDumper(yaml.SafeDumper):
        """Custom YAML dumper that uses single quotes for strings containing double quotes."""
        pass

    def _str_representer(dumper, data):
        if '"' in data:
            return dumper.represent_scalar('tag:yaml.org,2002:str', data, style="'")
        if '\n' in data:
            return dumper.represent_scalar('tag:yaml.org,2002:str', data, style='|')
        return dumper.represent_scalar('tag:yaml.org,2002:str', data)

    SafeQuoteDumper.add_representer(str, _str_representer)

    HAS_YAML = True
except ImportError:
    HAS_YAML = False
    SafeQuoteDumper = None


def parse_frontmatter_simple(text):
    """Parse YAML frontmatter without PyYAML. Handles the subset used in person files."""
    lines = text.split('\n')
    if not lines or lines[0].strip() != '---':
        return {}, text

    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            end = i
            break

    if end == -1:
        return {}, text

    fm_lines = lines[1:end]
    body = '\n'.join(lines[end + 1:])

    data = {}
    current_key = None
    current_list = None

    for line in fm_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        # List item
        if stripped.startswith('- ') and current_key:
            val = stripped[2:].strip().strip("'\"")
            if current_list is not None:
                current_list.append(val)
            continue

        # Key-value pair
        match = re.match(r'^(\w[\w_]*):\s*(.*)', line)
        if match:
            key = match.group(1)
            val = match.group(2).strip()

            if val == '' or val == '[]':
                # Could be start of a list or empty value
                data[key] = []
                current_key = key
                current_list = data[key]
            elif val.startswith('[') and val.endswith(']'):
                # Inline list
                items = val[1:-1].split(',')
                data[key] = [i.strip().strip("'\"") for i in items if i.strip()]
                current_key = key
                current_list = data[key]
            else:
                val = val.strip("'\"")
                data[key] = val
                current_key = key
                current_list = None

    return data, body


def parse_frontmatter(text):
    """Parse frontmatter from markdown text. Returns (frontmatter_dict, body_text)."""
    if HAS_YAML:
        lines = text.split('\n')
        if not lines or lines[0].strip() != '---':
            return {}, text
        end = -1
        for i in range(1, len(lines)):
            if lines[i].strip() == '---':
                end = i
                break
        if end == -1:
            return {}, text
        fm_text = '\n'.join(lines[1:end])
        body = '\n'.join(lines[end + 1:])
        try:
            data = yaml.safe_load(fm_text) or {}
        except yaml.YAMLError as e:
            print(f"  WARN: YAML parse error: {e}")
            return {}, text
        return data, body
    else:
        return parse_frontmatter_simple(text)


def serialize_enriched(original_text, extra_fields):
    """Preserve original frontmatter verbatim and append computed fields before the closing ---."""
    lines = original_text.split('\n')
    if not lines or lines[0].strip() != '---':
        return original_text

    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            end = i
            break

    if end == -1:
        return original_text

    # Build extra YAML lines
    extra_lines = []
    for key, val in extra_fields.items():
        if isinstance(val, list):
            if not val:
                extra_lines.append(f"{key}: []")
            else:
                extra_lines.append(f"{key}:")
                for item in val:
                    # Single-quote to avoid YAML issues
                    safe = str(item).replace("'", "''") if item else ''
                    extra_lines.append(f"  - '{safe}'")
        else:
            safe = str(val).replace("'", "''") if val else ''
            extra_lines.append(f"{key}: '{safe}'")

    # Insert before closing ---
    result_lines = lines[:end] + extra_lines + lines[end:]
    return '\n'.join(result_lines)


def serialize_frontmatter_simple(data):
    """Serialize dict to YAML-like frontmatter without PyYAML."""
    lines = []
    for key, val in data.items():
        if isinstance(val, list):
            if not val:
                lines.append(f"{key}: []")
            else:
                lines.append(f"{key}:")
                for item in val:
                    item_str = str(item) if item is not None else ''
                    if ':' in item_str or "'" in item_str or '"' in item_str or '#' in item_str:
                        lines.append(f"  - \"{item_str}\"")
                    else:
                        lines.append(f"  - '{item_str}'")
        elif val is None or val == '':
            lines.append(f"{key}: ''")
        elif isinstance(val, bool):
            lines.append(f"{key}: {'true' if val else 'false'}")
        else:
            val_str = str(val)
            if ':' in val_str or "'" in val_str or '#' in val_str:
                lines.append(f"{key}: \"{val_str}\"")
            else:
                lines.append(f"{key}: '{val_str}'")
    return '\n'.join(lines) + '\n'


def slugify(name):
    """Convert a person name to a filename slug."""
    name = name.lower().strip()
    name = re.sub(r'\(.*?\)', '', name)  # remove parentheticals
    name = re.sub(r"[''']", '', name)  # remove apostrophes
    name = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('ascii')
    name = re.sub(r'[^a-z0-9\s-]', '', name)
    name = re.sub(r'[\s]+', '-', name.strip())
    name = re.sub(r'-+', '-', name)
    return name


def build_name_lookup(people_dir):
    """Build a mapping of normalized names → (surname_dir, file_id) for relationship linking."""
    lookup = {}

    for surname_dir in sorted(os.listdir(people_dir)):
        surname_path = os.path.join(people_dir, surname_dir)
        if not os.path.isdir(surname_path) or surname_dir.startswith('.'):
            continue

        for fname in sorted(os.listdir(surname_path)):
            if not fname.endswith('.md') or fname.endswith('.bak'):
                continue

            fpath = os.path.join(surname_path, fname)
            with open(fpath, 'r', encoding='utf-8') as f:
                text = f.read()

            data, _ = parse_frontmatter(text)
            if not data.get('name'):
                continue

            file_id = data.get('id', fname.replace('.md', ''))
            name = data['name']

            # Store multiple lookup keys for this person
            slug = f"{surname_dir}/{file_id}"

            # Exact name
            lookup[name.lower()] = slug

            # Also store aliases
            for aka in data.get('aka', []) or []:
                if aka:
                    lookup[aka.lower()] = slug

            # Name without middle initial/name
            parts = name.split()
            if len(parts) >= 3:
                short = f"{parts[0]} {parts[-1]}"
                # Only store short form if unambiguous
                if short.lower() not in lookup:
                    lookup[short.lower()] = slug

            # Handle married names in parentheses — e.g., "Dorothy Elaine (Coppersmith) Krumpos"
            paren_match = re.search(r'\((\w+)\)', name)
            if paren_match:
                maiden = paren_match.group(1)
                first = parts[0]
                # "Dorothy Coppersmith"
                maiden_name = f"{first} {maiden}"
                if maiden_name.lower() not in lookup:
                    lookup[maiden_name.lower()] = slug

    return lookup


def resolve_links(names, lookup):
    """Resolve a list of name strings to slugs where possible."""
    linked = []
    for name in (names or []):
        if not name or not isinstance(name, str):
            continue
        key = name.lower().strip()
        # Try exact match first
        if key in lookup:
            linked.append(lookup[key])
        else:
            # Try without parenthetical
            clean = re.sub(r'\(.*?\)', '', key).strip()
            clean = re.sub(r'\s+', ' ', clean)
            if clean in lookup:
                linked.append(lookup[clean])
            else:
                # Try stripping marriage info like "(m. 1947-09-27)"
                name_only = re.sub(r'\s*\(m\..*?\)', '', key).strip()
                if name_only in lookup:
                    linked.append(lookup[name_only])
                else:
                    linked.append('')  # unresolved
    return linked


def export_people(source_dir, dest_dir, lookup):
    """Export person files with surname field and resolved links."""
    people_src = os.path.join(source_dir, 'people')
    people_dest = os.path.join(dest_dir, 'src', 'content', 'people')

    total = 0
    resolved = 0
    unresolved_names = []

    for surname_dir in sorted(os.listdir(people_src)):
        surname_path = os.path.join(people_src, surname_dir)
        if not os.path.isdir(surname_path) or surname_dir.startswith('.'):
            continue

        dest_surname = os.path.join(people_dest, surname_dir)
        os.makedirs(dest_surname, exist_ok=True)

        for fname in sorted(os.listdir(surname_path)):
            if not fname.endswith('.md') or fname.endswith('.bak'):
                continue

            fpath = os.path.join(surname_path, fname)
            with open(fpath, 'r', encoding='utf-8') as f:
                text = f.read()

            data, body = parse_frontmatter(text)
            if not data.get('name'):
                print(f"  SKIP: {surname_dir}/{fname} — no name in frontmatter")
                continue

            # Resolve relationships
            extra_fields = {'surname': surname_dir}
            for field, linked_field in [
                ('parents', 'linked_parents'),
                ('spouses', 'linked_spouses'),
                ('children', 'linked_children'),
            ]:
                names = data.get(field, []) or []
                if isinstance(names, str):
                    names = [names]
                links = resolve_links(names, lookup)
                extra_fields[linked_field] = links

                for i, name in enumerate(names):
                    if name and links[i]:
                        resolved += 1
                    elif name:
                        unresolved_names.append(f"{data['name']} → {field}: {name}")

            # Write enriched file — preserve original frontmatter, append computed fields
            output = serialize_enriched(text, extra_fields)
            dest_path = os.path.join(dest_surname, fname)
            with open(dest_path, 'w', encoding='utf-8') as f:
                f.write(output)

            total += 1

    return total, resolved, unresolved_names


def export_narratives(source_dir, dest_dir):
    """Copy narrative markdown files."""
    dest = os.path.join(dest_dir, 'src', 'content', 'narratives')
    os.makedirs(dest, exist_ok=True)

    count = 0
    for fname in ['lineage-narrative.md', 'family-narrative.md']:
        src = os.path.join(source_dir, fname)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, fname))
            count += 1

    # Also copy index files
    indexes_src = os.path.join(source_dir, 'indexes')
    if os.path.isdir(indexes_src):
        for fname in os.listdir(indexes_src):
            if fname.endswith('.md'):
                shutil.copy2(
                    os.path.join(indexes_src, fname),
                    os.path.join(dest, fname)
                )
                count += 1

    return count


def export_sources(source_dir, dest_dir):
    """Copy obituary and source files."""
    sources_src = os.path.join(source_dir, 'sources')
    dest = os.path.join(dest_dir, 'src', 'content', 'sources')
    os.makedirs(dest, exist_ok=True)

    count = 0
    for root, dirs, files in os.walk(sources_src):
        for fname in files:
            if fname.endswith('.md'):
                src = os.path.join(root, fname)
                shutil.copy2(src, os.path.join(dest, fname))
                count += 1

    return count


def export_media(source_dir, dest_dir):
    """Copy media files to public/media/."""
    media_src = os.path.join(source_dir, 'media')
    media_dest = os.path.join(dest_dir, 'public', 'media')

    count = 0
    for subdir in ['documents', 'photos']:
        src = os.path.join(media_src, subdir)
        dest = os.path.join(media_dest, subdir)
        if not os.path.isdir(src):
            continue
        os.makedirs(dest, exist_ok=True)
        for fname in os.listdir(src):
            if fname.startswith('.'):
                continue
            shutil.copy2(os.path.join(src, fname), os.path.join(dest, fname))
            count += 1

    return count


def main():
    parser = argparse.ArgumentParser(description='Export reliquary family-tree data to Astro content.')
    parser.add_argument('--source', required=True, help='Path to reliquary family-tree directory')
    parser.add_argument('--dest', required=True, help='Path to krumpos-tree project root')
    args = parser.parse_args()

    source = os.path.expanduser(args.source)
    dest = os.path.expanduser(args.dest)

    if not os.path.isdir(os.path.join(source, 'people')):
        print(f"ERROR: {source}/people not found. Is --source correct?")
        sys.exit(1)

    print(f"Source: {source}")
    print(f"Dest:   {dest}")
    print()

    # Step 1: Build name lookup
    print("Building name lookup table...")
    lookup = build_name_lookup(os.path.join(source, 'people'))
    print(f"  {len(lookup)} name variants indexed")
    print()

    # Step 2: Export people
    print("Exporting people...")
    total, resolved, unresolved = export_people(source, dest, lookup)
    print(f"  {total} people exported")
    print(f"  {resolved} relationship links resolved")
    if unresolved:
        print(f"  {len(unresolved)} unresolved names:")
        for name in sorted(set(unresolved))[:20]:
            print(f"    - {name}")
        if len(unresolved) > 20:
            print(f"    ... and {len(unresolved) - 20} more")
    print()

    # Step 3: Export narratives + indexes
    print("Exporting narratives and indexes...")
    n_count = export_narratives(source, dest)
    print(f"  {n_count} files copied")
    print()

    # Step 4: Export sources
    print("Exporting sources...")
    s_count = export_sources(source, dest)
    print(f"  {s_count} files copied")
    print()

    # Step 5: Export media
    print("Exporting media...")
    m_count = export_media(source, dest)
    print(f"  {m_count} files copied")
    print()

    print("Done.")


if __name__ == '__main__':
    main()
