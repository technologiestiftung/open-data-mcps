import { describe, expect, it } from 'vitest';
import { GetDatasetDetailsSchema, SearchDatasetsSchema, SearchFilteredSchema } from '../schemas.js';

describe('input schemas', () => {
  it('accepts dataset IDs and UUIDs', () => {
    expect(GetDatasetDetailsSchema.safeParse({ dataset_id: 'summe-kwk-anlagen-gesamt' }).success).toBe(true);
    expect(GetDatasetDetailsSchema.safeParse({ dataset_id: ' adressen_berlin ' }).success).toBe(true);
    expect(GetDatasetDetailsSchema.safeParse({ dataset_id: '6c8e3d0b-0c2c-4f4e-9f2a-0d6c1b0f3a11' }).success).toBe(true);
  });

  it.each([
    'Summe KWK-Anlagen gesamt',
    'https://daten.berlin.de/datensaetze/summe-kwk-anlagen-gesamt',
    '../summe-kwk',
    'x or 1=1',
    '<b>x</b>',
    '',
  ])('rejects dataset_id %j', (dataset_id) => {
    expect(GetDatasetDetailsSchema.safeParse({ dataset_id }).success).toBe(false);
  });

  it('validates modified_since dates', () => {
    expect(SearchFilteredSchema.safeParse({ modified_since: '2024-01-01' }).success).toBe(true);
    expect(SearchFilteredSchema.safeParse({ modified_since: '2024-01-01T12:00:00Z' }).success).toBe(true);
    expect(SearchFilteredSchema.safeParse({ modified_since: 'last year' }).success).toBe(false);
    expect(SearchFilteredSchema.safeParse({ modified_since: '2024-01-01 TO *]' }).success).toBe(false);
  });

  it('validates sort expressions', () => {
    expect(SearchDatasetsSchema.safeParse({ query: 'x', sort: 'metadata_modified desc' }).success).toBe(true);
    expect(SearchFilteredSchema.safeParse({ sort: 'score desc, metadata_modified desc' }).success).toBe(true);
    expect(SearchDatasetsSchema.safeParse({ query: 'x', sort: 'newest' }).success).toBe(false);
    expect(SearchDatasetsSchema.safeParse({ query: 'x', sort: 'title_string asc; drop' }).success).toBe(false);
  });
});
