# krumpos.org — Design Document

A family tree website for the Krumpos, Schmidt, Martin, Coppersmith, and allied families of northeastern Wisconsin. Built from structured genealogy data maintained in the reliquary repo.

---

## 1. Purpose & Audience

### Primary audience
- **Foggy's kids** — browsable, explorable, story-driven. They should be able to wander.
- **Elderly relatives** (aunts, uncles, cousins) — each gets a branch-specific link showing their side of the family. They can submit memories via a simple form.

### Goals
1. Make 173 ancestor profiles browsable and searchable
2. Tell the family story through narrative, not just data
3. Collect memories from living relatives before they're gone
4. Serve as a durable archive — static site, no runtime dependencies beyond Supabase for submissions

### Non-goals (milestone 1)
- Interactive tree visualization (deferred to milestone 2)
- Living history layer — maps, historical context, occupation explainers (deferred to milestone 2)
- Memoir integration / wildkrumpos.com cross-linking (future)

---

## 2. Architecture

### 2.1 Data Flow

```
reliquary/corpus/memoir/notes/family-tree/
    ├── people/**/*.md          (173 person files with YAML frontmatter)
    ├── sources/obituaries/*.md (7 obituary transcriptions)
    ├── indexes/*.md            (3 index documents)
    ├── media/documents/*.jpg   (census, certificates — ~25 files)
    ├── media/photos/*.jpg      (grave photos, portraits — ~13 files)
    ├── lineage-narrative.md    (long-form narrative)
    ├── family-narrative.md     (prose summary)
    └── indexes/
        ├── surname-origins.md
        └── cross-cutting-themes.md

        ↓ export script (Python)

krumpos-tree/
    ├── src/content/people/**/*.md   (copied, possibly enriched with slug/computed fields)
    ├── src/content/sources/*.md     (obituaries)
    ├── src/content/narratives/*.md  (lineage + family narratives)
    ├── public/media/documents/      (census images, certificates)
    └── public/media/photos/         (grave photos, portraits)
```

The export script is the only bridge. It:
- Copies person files, preserving surname directory structure
- Copies obituaries and narrative documents
- Copies media files into `public/`
- Optionally resolves relationship strings to slugs (e.g., "Claude Coppersmith" → `coppersmith/claude-coppersmith`) for cross-linking
- Reports any files with missing required frontmatter fields

### 2.2 Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | **Astro** | Static output, content collections, markdown-native |
| Styling | **Tailwind CSS** | Utility-first, minimal custom CSS |
| Search | **Pagefind** | Static search index, zero runtime cost, Cloudflare-friendly |
| Submissions | **Supabase** | One table: `memories`. Form posts via JS fetch. Foggy reviews in Supabase dashboard. |
| Hosting | **Cloudflare Pages** | Free tier, automatic deploys from git |
| Domain | **krumpos.org** | Heritage site — .org signals family/community |
| Package manager | **pnpm** | Consistent with Foggy's other projects |

### 2.3 No SSR

Fully static site. Supabase is the only external runtime dependency (for the submission form). Everything else is pre-rendered at build time.

---

## 3. Data Schema

### 3.1 Existing YAML Frontmatter (source of truth)

Every person file in reliquary already has this structure:

```yaml
---
id: joseph-krumpos                    # unique slug
name: Joseph Krumpos                  # display name
aka: []                               # optional aliases
birth: '1845-10-16'                   # ISO date string or year
death: '1920-02-19'                   # ISO date string or year
gender: M                             # M or F
immigration: '1867'                   # optional
burial: ''                            # optional cemetery/location
parents:                              # string array — names, not IDs
  - Unknown first wife
  - Mary Katherine Stefl
spouses:                              # string array — names, sometimes with (m. date)
  - Unknown first wife
  - Mary Katherine Stefl
children:                             # string array — names
  - Mary Krumpos
  - Joseph Samuel Krumpos
status: confirmed                     # confirmed | probable | research-target
uncertain_fields: []                  # optional
tags:                                 # string array
  - '#person'
  - '#krumpos'
created: '2025-09-18'
---
```

### 3.2 Astro Content Collection Schema

```typescript
// src/content.config.ts
import { defineCollection, z } from 'astro:content';

const people = defineCollection({
  type: 'content',
  schema: z.object({
    id: z.string(),
    name: z.string(),
    aka: z.array(z.string()).optional().default([]),
    birth: z.string().optional().default(''),
    death: z.string().optional().default(''),
    gender: z.enum(['M', 'F', '']).optional().default(''),
    immigration: z.string().optional().default(''),
    burial: z.string().optional().default(''),
    parents: z.array(z.string()).optional().default([]),
    spouses: z.array(z.string()).optional().default([]),
    children: z.array(z.string()).optional().default([]),
    status: z.enum(['confirmed', 'probable', 'research-target']).optional().default('confirmed'),
    uncertain_fields: z.array(z.string()).optional().default([]),
    tags: z.array(z.string()).optional().default([]),
    created: z.string().optional(),
    // Computed by export script:
    surname: z.string(),                    // from directory name
    linked_parents: z.array(z.string()).optional().default([]),   // resolved to slugs
    linked_spouses: z.array(z.string()).optional().default([]),
    linked_children: z.array(z.string()).optional().default([]),
  }),
});
```

### 3.3 Relationship Resolution

The export script builds a name→slug lookup from all person files, then adds `linked_parents`, `linked_spouses`, `linked_children` arrays containing slugs. Unresolved names remain as display strings — the templates handle both linked and unlinked names gracefully.

Example: `"Claude Coppersmith"` → `"coppersmith/claude-coppersmith"` (matches file path).

### 3.4 Supabase Schema

```sql
create table memories (
  id uuid primary key default gen_random_uuid(),
  person_id text not null,          -- matches the person file's id field
  person_name text not null,        -- display name, for quick scanning
  submitter_name text not null,
  submitter_relationship text,      -- "niece", "grandson", etc.
  submitter_email text,             -- optional, for follow-up
  memory text not null,
  created_at timestamptz default now(),
  reviewed boolean default false,   -- Foggy's curation flag
  published boolean default false   -- if/when we surface approved memories
);

-- RLS: insert-only for anonymous users, full access for Foggy
alter table memories enable row level security;
create policy "Anyone can submit" on memories for insert with check (true);
create policy "Owner reads all" on memories for select using (auth.role() = 'authenticated');
```

---

## 4. Page Types & Routing

### 4.1 Pages

| Route | Template | Description |
|-------|----------|-------------|
| `/` | `index.astro` | Home — lineage narrative excerpt, family line entry points, search |
| `/person/[surname]/[id]` | `[...slug].astro` | Individual ancestor page |
| `/surname/[name]` | `[name].astro` | All people in a surname group |
| `/branch/[line]` | `[line].astro` | Filtered view for sharing — Krumpos, Coppersmith, Martin, Schmidt |
| `/narrative` | `narrative.astro` | Full lineage narrative ("The Lines That Made Foggy") |
| `/themes` | `themes.astro` | Cross-cutting themes — longevity, synchronized deaths, naming patterns |
| `/origins` | `origins.astro` | Surname origins & immigrant streams |
| `/search` | `search.astro` | Pagefind search interface |
| `/about` | `about.astro` | What this site is, privacy note, how to contribute |

### 4.2 Person Page Layout

```
┌─────────────────────────────────────────────┐
│  Ancestry breadcrumb: Child → Parent → ...  │
├─────────────────────────────────────────────┤
│  Name                                       │
│  Birth — Death  ·  Origin/Immigration       │
│  Status badge (confirmed/probable/research)  │
├─────────────────────────────────────────────┤
│  Summary (prose from markdown body)          │
├─────────────────────────────────────────────┤
│  Relationships                               │
│    Parents:  [linked name] [linked name]     │
│    Spouse:   [linked name] (m. date)         │
│    Children: [linked name] [linked name]     │
├─────────────────────────────────────────────┤
│  Sources (obituaries, census, WikiTree)      │
├─────────────────────────────────────────────┤
│  Media (if any — census scans, grave photos) │
├─────────────────────────────────────────────┤
│  Research Notes (if any)                     │
├─────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐ │
│  │  "Remember something about [Name]?"     │ │
│  │  [Your name]  [Relationship]            │ │
│  │  [Your memory........................]  │ │
│  │  [Submit]                               │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 4.3 Branch Pages

Four branches, each rooted at a grandparent of Foggy's father Jim:

| Branch | Root person | Key lines | Shareable URL |
|--------|------------|-----------|---------------|
| Krumpos | Donald Howard Krumpos | Krumpos, Stefl, Kadletz, Schneider, Kosnar | `/branch/krumpos` |
| Coppersmith | Dorothy Elaine Coppersmith | Coppersmith, Bodoh, Young/Lajeunesse, Surprise/Surprenant, Belgian lines | `/branch/coppersmith` |
| Martin | Helen M. Martin | Martin, Hutchinson, Laing, Miller, Mielke, Pfister, Guernsey | `/branch/martin` |
| Schmidt | Clifford Alfred Schmidt | Schmidt, Rabe, Vollmer, Kurtz, Kendall, Forstall, Schindler, Lambert | `/branch/schmidt` |

Each branch page shows:
- Root person with brief narrative
- Pedigree list going back as far as data exists
- All people in the branch with links to full profiles
- The submission form (prominent — this is the page relatives will land on)

### 4.4 Surname Index Pages

One page per surname directory (28 total). Lists all people with that surname, sorted by birth date. Brief one-line summary per person. Link to full profile. Shows origin country/region from `indexes/surname-origins.md` if available.

---

## 5. Design Direction

### 5.1 Tone

Warm, archival, unhurried. Like opening a family album, not browsing a database. Serif headings (Georgia or similar system serif), clean sans-serif body text. Muted earth tones — parchment, warm gray, dark brown. No bright colors. No UI chrome that feels "techy."

### 5.2 Layout

- Single-column content, max-width ~720px for readability
- Generous whitespace and line-height
- Subtle horizontal rules between sections (like the markdown files themselves)
- Mobile-first — relatives will be on phones and iPads

### 5.3 Navigation

- Top: site name + minimal nav (Home, Search, Branches, About)
- Breadcrumbs on person pages showing lineage path
- Surname sidebar on index pages (collapsible on mobile)
- Branch selector on home page — four cards, one per grandparent line

### 5.4 No dark mode for milestone 1

Keep it simple. One warm, readable theme.

---

## 6. Export Script

### 6.1 Location

`scripts/export-from-reliquary.py` in the krumpos-tree repo. Requires only Python 3.10+ standard library plus `pyyaml`.

### 6.2 What it does

```
1. Read all .md files from reliquary family-tree/people/**/*.md
2. Parse YAML frontmatter from each
3. Build name→slug lookup table
4. For each person file:
   a. Inject `surname` field (from directory name)
   b. Resolve parents/spouses/children names to slugs where possible
   c. Add linked_parents/linked_spouses/linked_children to frontmatter
   d. Write to src/content/people/{Surname}/{id}.md
5. Copy narrative files to src/content/narratives/
6. Copy obituary files to src/content/sources/
7. Copy media/ to public/media/
8. Report: files copied, unresolved names, missing required fields
```

### 6.3 Invocation

```bash
python scripts/export-from-reliquary.py \
  --source ~/Documents/active_projects_local/reliquary/corpus/memoir/notes/family-tree \
  --dest .
```

Re-runnable. Overwrites destination. Idempotent.

---

## 7. Supabase Integration

### 7.1 Project

Use existing Supabase org or create a new project `krumpos-tree`. One table (`memories`), minimal config.

### 7.2 Client-side

Astro component with a `<form>` that posts to Supabase via the JS client. No authentication required for submission (insert-only RLS). Publishable key in the Astro config (not secret — it's a public anon key scoped to insert).

### 7.3 Notifications

Supabase webhook or database trigger → email notification to Foggy when a new memory is submitted. Alternatively, check the Supabase dashboard periodically.

### 7.4 Curation workflow

1. Relative submits memory on person page
2. Foggy sees it in Supabase dashboard (or gets email)
3. Foggy edits the corresponding person file in reliquary
4. Re-runs export, commits, deploys
5. Memory is now part of the permanent record

---

## 8. Search

Pagefind — runs at build time, generates a static search index. Searches person names, birth/death dates, locations, biography text, research notes. Zero runtime cost. Works perfectly on Cloudflare Pages.

The search page includes a simple text input. Results show person name, lifespan, and a snippet of the matching text. Click to go to the person page.

---

## 9. Milestone 1 Scope

### Phases (for GSD)

**Phase 1 — Scaffold**
- Initialize Astro project with Tailwind, Cloudflare Pages adapter
- Define content collection schema
- Write export script
- Run export, verify all 173 people files parse correctly
- Deploy empty shell to Cloudflare Pages

**Phase 2 — Person Pages**
- Person page template with full layout (section 4.2)
- Ancestry breadcrumbs (walk linked_parents chain)
- Relationship links (linked names are clickable, unlinked are plain text)
- Media display (census scans, photos) where available
- Render markdown body (summary, relationships, sources, research notes)

**Phase 3 — Index & Navigation**
- Home page with lineage narrative excerpt and branch entry points
- Surname index pages (28 pages, auto-generated from content collection)
- Branch landing pages (4 pages — Krumpos, Coppersmith, Martin, Schmidt)
- Site-wide navigation (header, breadcrumbs)
- Pagefind search integration

**Phase 4 — Narrative & Content Pages**
- Full lineage narrative page
- Cross-cutting themes page
- Surname origins page
- About page (what this is, privacy, how to contribute)

**Phase 5 — Submission Form**
- Supabase project + memories table
- Memory submission component (React island or vanilla JS)
- Form on every person page and branch page
- Success/error states
- RLS policies

**Phase 6 — Polish & Deploy**
- Typography and color system finalized
- Mobile responsiveness pass
- Favicon, meta tags, Open Graph (for link previews when sharing branch URLs)
- Final deploy to krumpos.org
- Test branch links end-to-end

### Out of scope for milestone 1
- Interactive tree visualization (d3)
- Historical context sidebars
- Occupation explainers
- Migration maps
- Era-appropriate cultural context
- Memoir cross-linking
- Authentication for Foggy (use Supabase dashboard directly)

---

## 10. File Structure

```
krumpos-tree/
├── DESIGN.md                          # This file
├── CLAUDE.md                          # AI working instructions
├── astro.config.mjs
├── tailwind.config.mjs
├── package.json
├── tsconfig.json
├── scripts/
│   └── export-from-reliquary.py       # One-way data pipeline
├── src/
│   ├── content.config.ts              # Astro content collection schema
│   ├── content/
│   │   ├── people/                    # Exported from reliquary (28 surname dirs)
│   │   │   ├── Krumpos/
│   │   │   ├── Coppersmith/
│   │   │   ├── Martin/
│   │   │   ├── Schmidt/
│   │   │   └── ...
│   │   ├── narratives/                # lineage-narrative.md, family-narrative.md
│   │   └── sources/                   # Obituary transcriptions
│   ├── layouts/
│   │   └── BaseLayout.astro           # HTML shell, nav, footer
│   ├── components/
│   │   ├── PersonCard.astro           # Summary card for index pages
│   │   ├── RelationshipLink.astro     # Linked or plain-text name
│   │   ├── AncestryBreadcrumb.astro   # Lineage trail
│   │   ├── MemoryForm.astro           # Supabase submission form
│   │   ├── SearchWidget.astro         # Pagefind wrapper
│   │   └── BranchTree.astro           # Pedigree list for branch pages
│   ├── pages/
│   │   ├── index.astro                # Home
│   │   ├── person/[...slug].astro     # Dynamic person pages
│   │   ├── surname/[name].astro       # Surname index pages
│   │   ├── branch/[line].astro        # Branch landing pages
│   │   ├── narrative.astro            # Full lineage narrative
│   │   ├── themes.astro               # Cross-cutting themes
│   │   ├── origins.astro              # Surname origins
│   │   ├── search.astro               # Pagefind search
│   │   └── about.astro                # About + privacy
│   └── styles/
│       └── global.css                 # Tailwind base + typography
└── public/
    ├── media/
    │   ├── documents/                 # Census scans, certificates
    │   └── photos/                    # Grave photos, portraits
    └── favicon.svg
```

---

## 11. Open Questions

1. **Media in git or external?** Currently 38 files, mostly JPEGs under 1MB each. Small enough to commit to the site repo. If it grows past ~200MB, consider Cloudflare R2.
2. **Notification mechanism for submissions.** Supabase webhook → email? Or just check the dashboard? Depends on submission volume (likely low).
3. **Branch definitions.** The four branches above are based on Foggy's paternal grandparents' parents. Should there be more granular branches (e.g., `/branch/bodoh` for the French-Canadian sub-line)? Start with four, add more if relatives ask.
4. **Privacy for living people.** Current data excludes living people per the README's privacy policy. The site should state this clearly on the About page. If a living relative submits a memory, their name appears only in Supabase, not on the public site, unless Foggy explicitly adds it.
