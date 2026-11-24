import type { ArticleKind, DomainGroup } from '../types';

const DOI_REGEX = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/;

/**
 * Normalizes a DOI string by stripping URL prefixes, `doi:` prefixes, whitespace, and trailing punctuation.
 */
export function normalizeDoi(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  cleaned = cleaned.replace(/^doi:\s*/i, '');
  cleaned = cleaned.replace(/[.,;]+$/, '');
  return cleaned.trim().toLowerCase();
}

/**
 * Validates whether a normalized DOI conforms to standard DOI syntax (10.XXXX/...).
 */
export function isValidDoi(raw: string): boolean {
  const normalized = normalizeDoi(raw);
  return DOI_REGEX.test(normalized);
}

/**
 * Parses a raw text block (newlines, commas, semicolons, tabs) into unique valid DOIs and invalid entries.
 */
export function parseDoiList(input: string): { valid: string[]; invalid: string[] } {
  const tokens = input
    .split(/[\r\n,;|\t]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const validSet = new Set<string>();
  const invalid: string[] = [];

  for (const token of tokens) {
    const norm = normalizeDoi(token);
    if (isValidDoi(norm)) {
      validSet.add(norm);
    } else {
      invalid.push(token);
    }
  }

  return { valid: Array.from(validSet), invalid };
}

/**
 * Maps messy group labels from CSV/TSV uploads onto one of the 3 canonical study groups.
 */
export function parseDomainGroup(raw: string | undefined, fallback: DomainGroup = 'Biodiversity'): DomainGroup {
  if (!raw) return fallback;
  const norm = raw.trim().toLowerCase();
  if (norm.includes('bio') || norm.includes('ecol') || norm.includes('species') || norm.includes('conserv')) {
    return 'Biodiversity';
  }
  if (norm.includes('climat') || norm.includes('warm') || norm.includes('carbon') || norm.includes('emiss')) {
    return 'Climate Change';
  }
  if (
    norm.includes('infect') ||
    norm.includes('disease') ||
    norm.includes('pathogen') ||
    norm.includes('epidem') ||
    norm.includes('malaria') ||
    norm.includes('virus')
  ) {
    return 'Infectious Diseases';
  }
  return fallback;
}

/**
 * Maps CSV/TSV type or boolean translated flags onto 'translated' | 'untranslated'.
 */
export function parseArticleKind(raw: string | undefined, fallback: ArticleKind = 'translated'): ArticleKind {
  if (!raw) return fallback;
  const norm = raw.trim().toLowerCase();
  if (
    norm === 'untranslated' ||
    norm === 'control' ||
    norm === 'original' ||
    norm === 'english' ||
    norm === 'false' ||
    norm === 'no' ||
    norm === '0'
  ) {
    return 'untranslated';
  }
  if (
    norm === 'translated' ||
    norm === 'translation' ||
    norm === 'bilingual' ||
    norm === 'true' ||
    norm === 'yes' ||
    norm === '1'
  ) {
    return 'translated';
  }
  return fallback;
}

export interface ParsedCsvRow {
  doi: string;
  group: DomainGroup;
  kind: ArticleKind;
  title?: string;
  abstract?: string;
  journal?: string;
  year?: number;
  language?: string;
  originalLanguage?: string;
  topics?: string[];
}

/**
 * RFC-4180 compliant single-line CSV/TSV splitter handling quoted commas and escaped quotes.
 */
function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses CSV or TSV content containing DOIs and optional metadata columns (group, type/translated, title, abstract, journal, year, topics).
 */
export function parseStructuredDoiFile(
  content: string,
  defaultGroup: DomainGroup = 'Biodiversity',
  defaultKind: ArticleKind = 'translated'
): { rows: ParsedCsvRow[]; skipped: number; headersDetected: boolean } {
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], skipped: 0, headersDetected: false };
  }

  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const firstCols = splitDelimitedLine(firstLine, delimiter).map((c) => c.toLowerCase());

  const hasHeader = firstCols.some((c) =>
    ['doi', 'group', 'topic', 'category', 'domain', 'type', 'kind', 'translated', 'is_translated', 'journal', 'year', 'abstract', 'title'].includes(
      c.replace(/[^a-z_]/g, '')
    )
  );

  if (!hasHeader) {
    const rows: ParsedCsvRow[] = [];
    let skipped = 0;
    for (const line of lines) {
      const cols = splitDelimitedLine(line, delimiter);
      const doiCandidate = cols[0] ?? '';
      const norm = normalizeDoi(doiCandidate);
      if (!isValidDoi(norm)) {
        skipped++;
        continue;
      }
      rows.push({
        doi: norm,
        group: parseDomainGroup(cols[1], defaultGroup),
        kind: parseArticleKind(cols[2], defaultKind),
      });
    }
    return { rows, skipped, headersDetected: false };
  }

  const colIndex = (aliases: string[]): number =>
    firstCols.findIndex((h) => aliases.includes(h.replace(/[^a-z_]/g, '')));

  const doiIdx = colIndex(['doi', 'article_doi', 'id']);
  const groupIdx = colIndex(['group', 'domain', 'category', 'subject', 'theme']);
  const kindIdx = colIndex(['kind', 'type', 'translated', 'is_translated', 'status', 'abstract_type']);
  const titleIdx = colIndex(['title', 'article_title']);
  const abstractIdx = colIndex(['abstract', 'abstract_text', 'text']);
  const journalIdx = colIndex(['journal', 'source', 'publication', 'venue']);
  const yearIdx = colIndex(['year', 'pub_year', 'publication_year']);
  const langIdx = colIndex(['language', 'lang']);
  const origLangIdx = colIndex(['original_language', 'source_language', 'orig_lang']);
  const topicsIdx = colIndex(['topics', 'keywords', 'concepts']);

  const rows: ParsedCsvRow[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitDelimitedLine(lines[i], delimiter);
    const rawDoi = doiIdx >= 0 ? cols[doiIdx] : cols[0];
    if (!rawDoi) {
      skipped++;
      continue;
    }
    const normDoi = normalizeDoi(rawDoi);
    if (!isValidDoi(normDoi)) {
      skipped++;
      continue;
    }

    const parsedYear = yearIdx >= 0 && cols[yearIdx] ? Number.parseInt(cols[yearIdx], 10) : undefined;
    const rawTopics = topicsIdx >= 0 && cols[topicsIdx] ? cols[topicsIdx] : undefined;

    rows.push({
      doi: normDoi,
      group: parseDomainGroup(groupIdx >= 0 ? cols[groupIdx] : undefined, defaultGroup),
      kind: parseArticleKind(kindIdx >= 0 ? cols[kindIdx] : undefined, defaultKind),
      title: titleIdx >= 0 && cols[titleIdx] ? cols[titleIdx] : undefined,
      abstract: abstractIdx >= 0 && cols[abstractIdx] ? cols[abstractIdx] : undefined,
      journal: journalIdx >= 0 && cols[journalIdx] ? cols[journalIdx] : undefined,
      year: parsedYear && !Number.isNaN(parsedYear) ? parsedYear : undefined,
      language: langIdx >= 0 && cols[langIdx] ? cols[langIdx] : undefined,
      originalLanguage: origLangIdx >= 0 && cols[origLangIdx] ? cols[origLangIdx] : undefined,
      topics: rawTopics
        ? rawTopics
            .split(/[;|]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    });
  }

  return { rows, skipped, headersDetected: true };
}
