import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDoi,
  normalizeDoi,
  parseArticleKind,
  parseDoiList,
  parseDomainGroup,
  parseStructuredDoiFile,
} from './doi';

test('normalizeDoi strips URLs, prefixes, whitespace, and trailing punctuation', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1111/cobi.14012'), '10.1111/cobi.14012');
  assert.equal(normalizeDoi('DOI: 10.1007/s10584-023-03512-4.'), '10.1007/s10584-023-03512-4');
  assert.equal(normalizeDoi('http://dx.doi.org/10.1371/journal.pntd.0011204;'), '10.1371/journal.pntd.0011204');
});

test('isValidDoi accepts valid DOIs and rejects malformed strings', () => {
  assert.equal(isValidDoi('10.1111/cobi.14012'), true);
  assert.equal(isValidDoi('https://doi.org/10.1186/s13071-024-06118-3'), true);
  assert.equal(isValidDoi('not-a-doi'), false);
  assert.equal(isValidDoi('10.12/short-prefix'), false);
});

test('parseDoiList deduplicates valid DOIs and isolates invalid entries', () => {
  const result = parseDoiList(
    '10.1111/cobi.14012\nhttps://doi.org/10.1111/cobi.14012, 10.1111/gcb.17104; bad_entry'
  );
  assert.deepEqual(result.valid, ['10.1111/cobi.14012', '10.1111/gcb.17104']);
  assert.deepEqual(result.invalid, ['bad_entry']);
});

test('parseDomainGroup and parseArticleKind map canonical labels accurately', () => {
  assert.equal(parseDomainGroup('climate change'), 'Climate Change');
  assert.equal(parseDomainGroup('Infectious Disease'), 'Infectious Diseases');
  assert.equal(parseDomainGroup('biodiversity'), 'Biodiversity');
  assert.equal(parseArticleKind('untranslated'), 'untranslated');
  assert.equal(parseArticleKind('control'), 'untranslated');
  assert.equal(parseArticleKind('translated'), 'translated');
  assert.equal(parseArticleKind('true'), 'translated');
});

test('parseStructuredDoiFile parses CSV with headers and quoted abstracts', () => {
  const csv = [
    'doi,group,type,journal,year,title,abstract',
    '10.1111/cobi.14012,Biodiversity,translated,Conservation Biology,2023,"Frog study","Riparian buffers, streams, and frogs."',
    '10.1111/gcb.17104,Climate Change,untranslated,Global Change Biology,2024,"Permafrost study","Methane flux in peatlands."',
    'invalid-row,Biodiversity,translated,Conservation Biology,2023,"Bad","Skip"',
  ].join('\n');

  const parsed = parseStructuredDoiFile(csv);
  assert.equal(parsed.headersDetected, true);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].doi, '10.1111/cobi.14012');
  assert.equal(parsed.rows[0].group, 'Biodiversity');
  assert.equal(parsed.rows[0].kind, 'translated');
  assert.equal(parsed.rows[0].year, 2023);
  assert.equal(parsed.rows[0].abstract, 'Riparian buffers, streams, and frogs.');
  assert.equal(parsed.rows[1].kind, 'untranslated');
});
