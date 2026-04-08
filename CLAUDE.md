# krumpos-tree

Family tree website at krumpos.org. Astro + Tailwind + Cloudflare Pages.

## Data flow

Source of truth: `reliquary/corpus/memoir/notes/family-tree/`

Export pipeline: `pnpm export` runs `scripts/export-from-reliquary.py` which:
- Copies 173 person files into `src/content/people/{Surname}/`
- Resolves relationship names to slugs (linked_parents, linked_spouses, linked_children)
- Copies narratives, obituaries, and media files
- Preserves original frontmatter verbatim, appends computed fields

**Never edit files in `src/content/` directly** — they are overwritten by the export. Edit the source in reliquary, then re-export.

## Build

```bash
pnpm export    # Pull latest data from reliquary
pnpm build     # Astro build + Pagefind search index
pnpm preview   # Local preview
```

## Stack
- Astro 6, Tailwind v4, Cloudflare Pages
- Pagefind for static search
- Supabase for memory submissions (planned)
- pnpm

## Content collections
- `people` — 173 ancestor profiles with YAML frontmatter
- `narratives` — lineage narrative, family narrative, indexes
- `sources` — obituary transcriptions

## Page structure
- `/person/{Surname}/{id}` — individual ancestor pages
- `/surname/{name}` — 28 surname index pages
- `/branch/{line}` — 4 shareable branch pages (krumpos, coppersmith, martin, schmidt)
- `/narrative` — full lineage narrative
- `/themes` — cross-cutting patterns
- `/origins` — surname origins & immigrant streams
- `/search` — Pagefind search
- `/about` — site info, privacy, contribution guide

## Branch definitions
Defined in `src/lib/branches.ts`. Each branch maps to a set of surnames.
