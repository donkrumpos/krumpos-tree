// Verified person <-> obituary-source links (2026-07-19).
// Each entry matched by death date between the person record and the source.
// `person` is the person's frontmatter `id`; `surname` is its `surname` field
// (case-sensitive — the /person/<Surname>/<id>/ route preserves case).
// `source` is the sources-collection id (filename without .md).
export interface ObituaryLink {
  person: string;
  surname: string;
  source: string;
}

export const obituaryLinks: ObituaryLink[] = [
  { person: 'dorothy-elaine-coppersmith',   surname: 'Coppersmith', source: 'dorothy-elaine-krumpos-2002' },
  { person: 'dorothy-l-krumpos',            surname: 'Krumpos',     source: 'dorothy-l-krumpos-matuszak-2011' },
  { person: 'florence-coppersmith',         surname: 'Coppersmith', source: 'florence-coppersmith-challe-2020' },
  { person: 'kenneth-l-krumpos',            surname: 'Krumpos',     source: 'kenneth-l-krumpos-2001' },
  { person: 'lawrence-larry-krumpos',       surname: 'Krumpos',     source: 'larry-krumpos-2013' },
  { person: 'lester-f-martin-jr',           surname: 'Martin',      source: 'lester-f-martin-jr-2011' },
  { person: 'mabel-ruth-schneider-reinke',  surname: 'Schneider',   source: 'mabel-reinke-1992' },
  { person: 'roger-h-coppersmith',          surname: 'Coppersmith', source: 'roger-h-coppersmith-2018' },
];

export const linkByPerson = new Map(obituaryLinks.map((l) => [l.person, l]));
export const linkBySource = new Map(obituaryLinks.map((l) => [l.source, l]));
