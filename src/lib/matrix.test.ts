import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ARTICLES } from '../data/seedData';
import { generatePairings } from './pairing';
import { buildStratumDistanceMatrices } from './matrix';
import { buildAllMatricesLongCsv, buildSingleMatrixCsv } from './export';

test('builds one symmetric N x N distance matrix per (journal, year) stratum on unified [0, 1] scale', () => {
  const pairingResult = generatePairings(SEED_ARTICLES, { metric: 'hybrid' });
  const matrices = buildStratumDistanceMatrices(SEED_ARTICLES, 'hybrid', pairingResult.pairs);

  // Seed data has exactly 6 distinct (journal, year) strata, each with 4 articles (2T + 2U)
  assert.equal(matrices.length, 6);

  for (const m of matrices) {
    assert.equal(m.scaleMin, 0);
    assert.equal(m.scaleMax, 1);
    const n = m.articles.length;
    assert.equal(n, 4);
    assert.equal(m.distances.length, n);

    for (let i = 0; i < n; i++) {
      assert.equal(m.distances[i].length, n);
      // Every article in the matrix must share the exact same journal and year
      assert.equal(m.articles[i].journal, m.journal);
      assert.equal(m.articles[i].year, m.year);
      // Diagonal must be exact 0.000
      assert.equal(m.distances[i][i], 0);

      for (let j = 0; j < n; j++) {
        const d = m.distances[i][j];
        assert.ok(d >= 0 && d <= 1, `Distance out of [0, 1] scale: ${d}`);
        // Strict symmetry
        assert.equal(m.distances[i][j], m.distances[j][i]);
      }
    }
  }
});

test('orders translated articles before untranslated controls and marks active pairings inside matrix', () => {
  const pairingResult = generatePairings(SEED_ARTICLES, { metric: 'hybrid' });
  const matrices = buildStratumDistanceMatrices(SEED_ARTICLES, 'hybrid', pairingResult.pairs);
  const cobi = matrices.find((m) => m.journal === 'Conservation Biology' && m.year === 2023)!;

  assert.ok(cobi);
  assert.equal(cobi.articles[0].kind, 'translated');
  assert.equal(cobi.articles[1].kind, 'translated');
  assert.equal(cobi.articles[2].kind, 'untranslated');
  assert.equal(cobi.articles[3].kind, 'untranslated');

  // Topically close pair (amphibian T1 vs amphibian U1) must be closer (lower distance) than amphibian T1 vs cetacean U2
  const distClose = cobi.distances[0][2];
  const distFar = cobi.distances[0][3];
  assert.ok(distClose < distFar, `Expected ${distClose} < ${distFar}`);
  assert.ok(cobi.activePairKeys.size >= 2);
});

test('exports symmetric N x N matrix CSV and long-form all-matrices CSV cleanly', () => {
  const pairingResult = generatePairings(SEED_ARTICLES, { metric: 'hybrid' });
  const matrices = buildStratumDistanceMatrices(SEED_ARTICLES, 'hybrid', pairingResult.pairs);

  const singleCsv = buildSingleMatrixCsv(matrices[0]);
  const singleLines = singleCsv.split('\n');
  // 1 header row + 4 article rows
  assert.equal(singleLines.length, 5);
  assert.ok(singleLines[0].startsWith('doi_role,'));
  assert.ok(singleLines[1].includes('0.0000'));

  const longCsv = buildAllMatricesLongCsv(matrices);
  const longLines = longCsv.split('\n');
  // 1 header + 6 matrices * (4 * 3 / 2 = 6 unique upper-triangle pairs each) = 37 rows
  assert.equal(longLines.length, 1 + 6 * 6);
  assert.ok(longLines[0].includes('distance_scale_min,distance_scale_max'));
});
