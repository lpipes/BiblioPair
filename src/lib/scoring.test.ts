import test from 'node:test';
import assert from 'node:assert/strict';
import type { Article } from '../types';
import { buildCorpusIdf, computeTopicOverlap } from './scoring';

const makeArticle = (overrides: Partial<Article>): Article => ({
  id: 'a1',
  doi: '10.1111/test.001',
  title: 'Default title',
  abstract: 'Default abstract',
  journal: 'Conservation Biology',
  year: 2023,
  group: 'Biodiversity',
  kind: 'translated',
  topics: [],
  source: 'manual',
  ...overrides,
});

test('identical abstracts and topics produce exact 0.000 overlap distance across all metrics', () => {
  const a = makeArticle({
    id: 't1',
    doi: '10.1111/test.001',
    title: 'Riparian corridor width and Neotropical amphibian occupancy',
    abstract:
      'Native riparian forest corridors preserve microhabitat humidity and sustain Neotropical amphibian species richness.',
    topics: [
      { name: 'Amphibian conservation', score: 0.95 },
      { name: 'Riparian corridors', score: 0.9 },
    ],
  });
  const b = makeArticle({
    ...a,
    id: 'u1',
    doi: '10.1111/test.002',
    kind: 'untranslated',
  });

  const idf = buildCorpusIdf([a, b]);
  const hybrid = computeTopicOverlap(a, b, idf, 'hybrid');
  const jsd = computeTopicOverlap(a, b, idf, 'jsd');
  const jaccard = computeTopicOverlap(a, b, idf, 'jaccard');

  assert.equal(hybrid.distance, 0);
  assert.equal(hybrid.lexicalDistance, 0);
  assert.equal(hybrid.conceptDistance, 0);
  assert.equal(jsd.distance, 0);
  assert.equal(jaccard.distance, 0);
  assert.ok(hybrid.sharedTerms.length > 0);
});

test('completely disjoint abstracts and topics produce 1.000 overlap distance', () => {
  const a = makeArticle({
    id: 't1',
    title: 'Permafrost methane flux in boreal peatlands',
    abstract: 'Arctic permafrost thaw accelerates anaerobic methanogenesis in thermokarst bogs.',
    topics: [{ name: 'Permafrost thaw', score: 0.95 }],
  });
  const b = makeArticle({
    id: 'u1',
    doi: '10.1111/test.002',
    kind: 'untranslated',
    title: 'Praziquantel treatment for freshwater schistosomiasis',
    abstract: 'School-based chemotherapy lowers helminth egg intensity near lakeshore clinics.',
    topics: [{ name: 'Schistosomiasis', score: 0.95 }],
  });

  const idf = buildCorpusIdf([a, b]);
  const result = computeTopicOverlap(a, b, idf, 'hybrid');

  assert.equal(result.distance, 1);
  assert.equal(result.jsdDistance, 1);
  assert.equal(result.jaccardDistance, 1);
  assert.equal(result.sharedTerms.length, 0);
});

test('closely related topics score strictly lower (closer to 0) than unrelated topics and scoring is symmetric', () => {
  const translated = makeArticle({
    id: 't1',
    title: 'Aedes aegypti larval surveillance predicts urban dengue epidemics',
    abstract: 'Municipal container larval indices and rainfall anomalies forecast dengue transmission hotspots.',
    topics: [
      { name: 'Dengue transmission', score: 0.95 },
      { name: 'Aedes aegypti', score: 0.92 },
    ],
  });
  const closeControl = makeArticle({
    id: 'u-close',
    doi: '10.1371/u1',
    kind: 'untranslated',
    title: 'Entomological larval indices forecast urban dengue outbreaks',
    abstract: 'Aedes aegypti container larval surveillance and rainfall lags predict dengue transmission hotspots.',
    topics: [
      { name: 'Dengue transmission', score: 0.96 },
      { name: 'Aedes aegypti', score: 0.9 },
    ],
  });
  const distantControl = makeArticle({
    id: 'u-far',
    doi: '10.1371/u2',
    kind: 'untranslated',
    title: 'Glacier mass balance retreat in alpine watersheds',
    abstract: 'Shrinking mountain snowpack alters irrigation runoff timing in highland basins.',
    topics: [{ name: 'Glacier retreat', score: 0.92 }],
  });

  const idf = buildCorpusIdf([translated, closeControl, distantControl]);
  const scoreClose = computeTopicOverlap(translated, closeControl, idf, 'hybrid');
  const scoreCloseReverse = computeTopicOverlap(closeControl, translated, idf, 'hybrid');
  const scoreFar = computeTopicOverlap(translated, distantControl, idf, 'hybrid');

  assert.ok(scoreClose.distance > 0 && scoreClose.distance < 0.45, `Expected low distance, got ${scoreClose.distance}`);
  assert.ok(scoreFar.distance > 0.85, `Expected high distance, got ${scoreFar.distance}`);
  assert.ok(scoreClose.distance < scoreFar.distance);
  assert.equal(scoreClose.distance, scoreCloseReverse.distance);
});
