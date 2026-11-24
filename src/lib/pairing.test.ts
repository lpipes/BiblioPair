import test from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '../types';
import { generatePairings, isSameJournalAndYear } from './pairing';
import { SEED_ARTICLES } from '../data/seedData';

const makeArticle = (overrides: Partial<Article>): Article => ({
  id: 'id-1',
  doi: '10.1000/1',
  title: 'Test article',
  abstract: 'Amphibian conservation in riparian forest corridors.',
  journal: 'Conservation Biology',
  year: 2023,
  group: 'Biodiversity',
  kind: 'translated',
  topics: [{ name: 'Amphibian conservation', score: 0.9 }],
  source: 'manual',
  ...overrides,
});

test('strictly enforces same-journal and same-year constraint', () => {
  const t = makeArticle({ id: 't1', doi: '10.1/t1', journal: 'Conservation Biology', year: 2023, kind: 'translated' });
  const uSame = makeArticle({ id: 'u1', doi: '10.1/u1', journal: 'Conservation Biology', year: 2023, kind: 'untranslated' });
  const uDiffYear = makeArticle({ id: 'u2', doi: '10.1/u2', journal: 'Conservation Biology', year: 2022, kind: 'untranslated' });
  const uDiffJournal = makeArticle({ id: 'u3', doi: '10.1/u3', journal: 'Global Change Biology', year: 2023, kind: 'untranslated' });

  assert.equal(isSameJournalAndYear(t, uSame), true);
  assert.equal(isSameJournalAndYear(t, uDiffYear), false);
  assert.equal(isSameJournalAndYear(t, uDiffJournal), false);

  const res = generatePairings([t, uDiffYear, uDiffJournal]);
  assert.equal(res.pairs.length, 0);
  assert.deepEqual(res.unpairedTranslatedIds, ['t1']);
});

test('allows multiple translated articles to reuse the same untranslated article when it is the closest match', () => {
  const t1 = makeArticle({
    id: 't1',
    doi: '10.1/t1',
    kind: 'translated',
    title: 'Andean frog occupancy in riparian corridors',
    abstract: 'Neotropical amphibian richness increases with wider native riparian forest buffers.',
    topics: [{ name: 'Amphibian conservation', score: 0.95 }],
  });
  const t2 = makeArticle({
    id: 't2',
    doi: '10.1/t2',
    kind: 'translated',
    title: 'Coffee stream riparian buffers recover montane frogs',
    abstract: 'Native riparian corridors support amphibian occupancy and frog richness across streams.',
    topics: [{ name: 'Amphibian conservation', score: 0.92 }],
  });
  const uSharedBest = makeArticle({
    id: 'u-best',
    doi: '10.1/u-best',
    kind: 'untranslated',
    title: 'Riparian corridor thresholds for Neotropical amphibians',
    abstract: 'Wider native riparian forest buffers preserve frog richness and amphibian occupancy.',
    topics: [{ name: 'Amphibian conservation', score: 0.96 }],
  });
  const uUnrelated = makeArticle({
    id: 'u-far',
    doi: '10.1/u-far',
    kind: 'untranslated',
    title: 'Pelagic tuna longline cetacean bycatch',
    abstract: 'Hydrophone arrays measure marine mammal depredation on deep-sea commercial vessels.',
    topics: [{ name: 'Marine mammal bycatch', score: 0.95 }],
  });

  const res = generatePairings([t1, t2, uSharedBest, uUnrelated], { pairsPerTranslated: 1 });
  assert.equal(res.unpairedTranslatedIds.length, 0);
  assert.equal(res.pairs.length, 2);
  assert.equal(res.pairs.every((p) => p.untranslatedId === 'u-best'), true);
  assert.equal(res.untranslatedReuseCount['u-best'], 2);
});

test('guarantees every translated article in the seed corpus has >= 1 valid same-journal same-year pairing', () => {
  const res = generatePairings(SEED_ARTICLES, { pairsPerTranslated: 1, metric: 'hybrid' });
  const translatedCount = SEED_ARTICLES.filter((a) => a.kind === 'translated').length;

  assert.equal(translatedCount, 12);
  assert.equal(res.unpairedTranslatedIds.length, 0);
  assert.equal(res.pairs.length, 12);

  const byId = new Map(SEED_ARTICLES.map((a) => [a.id, a]));
  for (const pair of res.pairs) {
    const t = byId.get(pair.translatedId)!;
    const u = byId.get(pair.untranslatedId)!;
    assert.equal(t.kind, 'translated');
    assert.equal(u.kind, 'untranslated');
    assert.equal(t.journal, u.journal);
    assert.equal(t.year, u.year);
    assert.ok(pair.breakdown.distance >= 0 && pair.breakdown.distance <= 1);
  }

  // Confirm shared untranslated reuse occurs naturally in strata with two topically aligned translated papers
  const reusedCount = Object.values(res.untranslatedReuseCount).filter((count) => count > 1).length;
  assert.ok(reusedCount >= 2, `Expected at least 2 reused untranslated controls in seed data, found ${reusedCount}`);
});

test('never leaves a translated article unpaired even if user excludes a candidate when another exists', () => {
  const t = makeArticle({ id: 't1', doi: '10.1/t1', kind: 'translated' });
  const u1 = makeArticle({ id: 'u1', doi: '10.1/u1', kind: 'untranslated' });

  const res = generatePairings([t, u1], {
    excludedPairKeys: new Set(['t1::u1']),
  });
  assert.equal(res.pairs.length, 1);
  assert.equal(res.pairs[0].untranslatedId, 'u1');
});

test('adding a manual pair augments automatic best match rather than displacing it', () => {
  const t = makeArticle({ id: 't1', doi: '10.1/t1', kind: 'translated' });
  const u1 = makeArticle({ id: 'u1', doi: '10.1/u1', kind: 'untranslated' });
  const u2 = makeArticle({
    id: 'u2',
    doi: '10.1/u2',
    kind: 'untranslated',
    title: 'Pelagic fisheries acoustics',
    abstract: 'Marine mammal hydrophone deterrence in commercial tuna vessels.',
    topics: [{ name: 'Fisheries', score: 0.9 }],
  });

  const base = generatePairings([t, u1, u2], { pairsPerTranslated: 1 });
  assert.equal(base.pairs.length, 1);

  const augmented = generatePairings([t, u1, u2], {
    pairsPerTranslated: 1,
    manualLinks: [{ translatedId: 't1', untranslatedId: 'u2' }],
  });
  assert.equal(augmented.pairs.length, 2);
  assert.equal(augmented.pairs.some((p) => p.untranslatedId === 'u1'), true);
  assert.equal(augmented.pairs.some((p) => p.untranslatedId === 'u2' && p.isManual), true);
});
