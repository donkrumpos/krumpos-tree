import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Coerce YAML dates/numbers to strings for display fields
const flexString = z.union([z.string(), z.number(), z.date()])
  .transform(v => String(v))
  .optional()
  .default('');

const flexStringArray = z.array(
  z.union([z.string(), z.number(), z.date()]).transform(v => String(v))
).optional().default([]);

const people = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/people' }),
  schema: z.object({
    id: z.string(),
    name: z.string(),
    aka: flexStringArray,
    birth: flexString,
    death: flexString,
    gender: z.string().optional().default(''),
    immigration: flexString,
    burial: z.string().optional().default(''),
    parents: flexStringArray,
    spouses: flexStringArray,
    children: flexStringArray,
    status: z.string().optional().default('confirmed'),
    uncertain_fields: z.array(z.any()).optional().default([]),
    tags: flexStringArray,
    created: flexString,
    // Computed by export script
    surname: z.string(),
    linked_parents: z.array(z.string()).optional().default([]),
    linked_spouses: z.array(z.string()).optional().default([]),
    linked_children: z.array(z.string()).optional().default([]),
  }),
});

const narratives = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/narratives' }),
  schema: z.object({
    title: z.string().optional(),
    created: z.string().optional(),
    type: z.string().optional(),
  }).passthrough(),
});

const sources = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/sources' }),
  schema: z.object({}).passthrough(),
});

export const collections = { people, narratives, sources };
