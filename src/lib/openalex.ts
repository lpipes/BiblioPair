import type { Article, ArticleKind, DomainGroup, TopicTag } from '../types';
import { normalizeDoi } from './doi';

interface OpenAlexWork {
  id: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  language?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    source?: {
      id?: string;
      display_name?: string;
      issn_l?: string;
    } | null;
  } | null;
  authorships?: Array<{
    author?: { display_name?: string };
  }>;
  topics?: Array<{
    display_name?: string;
    score?: number;
  }>;
  concepts?: Array<{
    display_name?: string;
    score?: number;
  }>;
  keywords?: Array<{
    display_name?: string;
    score?: number;
  }>;
}

/**
 * Reconstructs plain abstract text from OpenAlex's inverted index representation.
 */
export function reconstructInvertedAbstract(index?: Record<string, number[]> | null): string {
  if (!index) return '';
  const positions: Array<{ pos: number; word: string }> = [];
  for (const [word, idxs] of Object.entries(index)) {
    for (const pos of idxs) {
      positions.push({ pos, word });
    }
  }
  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(' ').trim();
}

function stripJatsXml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapOpenAlexWorkToArticle(
  work: OpenAlexWork,
  group: DomainGroup,
  kind: ArticleKind,
  fallbackDoi?: string
): Article {
  const doi = normalizeDoi(work.doi ?? fallbackDoi ?? work.id);
  const abstract = reconstructInvertedAbstract(work.abstract_inverted_index);
  const journal = work.primary_location?.source?.display_name ?? 'Unknown Journal';
  const journalId = work.primary_location?.source?.id;
  const issn = work.primary_location?.source?.issn_l;
  const year = work.publication_year ?? new Date().getFullYear();

  const topicsMap = new Map<string, number>();
  for (const t of work.topics ?? []) {
    if (t.display_name) {
      topicsMap.set(t.display_name, Math.max(topicsMap.get(t.display_name) ?? 0, t.score ?? 0.85));
    }
  }
  for (const k of work.keywords ?? []) {
    if (k.display_name) {
      topicsMap.set(k.display_name, Math.max(topicsMap.get(k.display_name) ?? 0, k.score ?? 0.7));
    }
  }
  for (const c of (work.concepts ?? []).slice(0, 6)) {
    if (c.display_name && (c.score ?? 0) >= 0.3) {
      topicsMap.set(c.display_name, Math.max(topicsMap.get(c.display_name) ?? 0, c.score ?? 0.5));
    }
  }

  const topics: TopicTag[] = Array.from(topicsMap.entries())
    .map(([name, score]) => ({ name, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const authors = (work.authorships ?? [])
    .map((a) => a.author?.display_name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 5);

  return {
    id: `oa-${doi}`,
    doi,
    title: work.title?.trim() || `Untitled (${doi})`,
    abstract,
    journal,
    journalId,
    issn,
    year,
    group,
    kind,
    language: work.language ?? 'en',
    authors,
    topics,
    source: 'openalex',
  };
}

/**
 * Fetches article metadata & abstract for a single DOI from OpenAlex, falling back to Crossref if needed.
 */
export async function fetchArticleByDoi(
  rawDoi: string,
  group: DomainGroup,
  kind: ArticleKind
): Promise<{ article?: Article; error?: string }> {
  const doi = normalizeDoi(rawDoi);

  try {
    const oaUrl = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?mailto=bibliopair-research@example.org`;
    const oaRes = await fetch(oaUrl, { headers: { Accept: 'application/json' } });

    if (oaRes.ok) {
      const work = (await oaRes.json()) as OpenAlexWork;
      const article = mapOpenAlexWorkToArticle(work, group, kind, doi);

      // If OpenAlex lacks abstract, attempt Crossref enrichment
      if (!article.abstract) {
        const cr = await fetchCrossrefAbstract(doi);
        if (cr) {
          article.abstract = cr;
        }
      }
      return { article };
    }
  } catch {
    // Fall through to Crossref fallback
  }

  try {
    const crUrl = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const crRes = await fetch(crUrl, { headers: { Accept: 'application/json' } });
    if (crRes.ok) {
      const payload = await crRes.json();
      const msg = payload?.message;
      if (msg) {
        const title = Array.isArray(msg.title) ? msg.title[0] : msg.title || `Untitled (${doi})`;
        const journal = Array.isArray(msg['container-title'])
          ? msg['container-title'][0]
          : msg['container-title'] || 'Unknown Journal';
        const dateParts =
          msg.published?.['date-parts']?.[0] ??
          msg['published-print']?.['date-parts']?.[0] ??
          msg['published-online']?.['date-parts']?.[0] ??
          msg.issued?.['date-parts']?.[0];
        const year = typeof dateParts?.[0] === 'number' ? dateParts[0] : new Date().getFullYear();
        const abstract = typeof msg.abstract === 'string' ? stripJatsXml(msg.abstract) : '';
        const issn = Array.isArray(msg.ISSN) ? msg.ISSN[0] : undefined;
        const subjects: TopicTag[] = Array.isArray(msg.subject)
          ? msg.subject.slice(0, 6).map((s: string) => ({ name: s, score: 0.75 }))
          : [];

        return {
          article: {
            id: `cr-${doi}`,
            doi,
            title: String(title),
            abstract,
            journal: String(journal),
            issn,
            year,
            group,
            kind,
            language: msg.language ?? 'en',
            topics: subjects,
            source: 'crossref',
          },
        };
      }
    }
  } catch {
    // Both APIs unreachable
  }

  return { error: `Could not resolve DOI "${doi}" via OpenAlex or Crossref.` };
}

async function fetchCrossrefAbstract(doi: string): Promise<string> {
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return '';
    const json = await res.json();
    const raw = json?.message?.abstract;
    return typeof raw === 'string' ? stripJatsXml(raw) : '';
  } catch {
    return '';
  }
}

/**
 * Discovers real untranslated candidate articles from OpenAlex in the exact same journal and publication year.
 */
export async function fetchSameJournalYearControls(
  translated: Article,
  excludeDois: Set<string>,
  limit = 10
): Promise<{ articles: Article[]; error?: string }> {
  try {
    let sourceId = translated.journalId;

    // Resolve OpenAlex source ID from ISSN or journal title if not already attached
    if (!sourceId) {
      const searchParam = translated.issn
        ? `filter=issn:${encodeURIComponent(translated.issn)}`
        : `search=${encodeURIComponent(translated.journal)}`;
      const srcRes = await fetch(
        `https://api.openalex.org/sources?${searchParam}&per-page=1&mailto=bibliopair-research@example.org`
      );
      if (srcRes.ok) {
        const srcJson = await srcRes.json();
        sourceId = srcJson?.results?.[0]?.id;
      }
    }

    if (!sourceId) {
      return {
        articles: [],
        error: `Could not locate journal "${translated.journal}" in OpenAlex.`,
      };
    }

    const shortSourceId = sourceId.replace('https://openalex.org/', '');
    const filter = [
      `primary_location.source.id:${shortSourceId}`,
      `publication_year:${translated.year}`,
      `has_abstract:true`,
      `language:en`,
    ].join(',');

    const worksUrl = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&per-page=${limit + 4}&mailto=bibliopair-research@example.org`;
    const res = await fetch(worksUrl, { headers: { Accept: 'application/json' } });

    if (!res.ok) {
      return {
        articles: [],
        error: `OpenAlex returned status ${res.status} while querying controls for ${translated.journal} (${translated.year}).`,
      };
    }

    const data = await res.json();
    const works: OpenAlexWork[] = Array.isArray(data?.results) ? data.results : [];

    const mapped: Article[] = [];
    for (const work of works) {
      if (mapped.length >= limit) break;
      if (!work.doi) continue;
      const norm = normalizeDoi(work.doi);
      if (excludeDois.has(norm) || norm === normalizeDoi(translated.doi)) continue;
      const article = mapOpenAlexWorkToArticle(work, translated.group, 'untranslated', norm);
      // Ensure exact journal name matches the translated stratum cleanly
      article.journal = translated.journal;
      if (!article.journalId) article.journalId = sourceId;
      if (article.abstract.length > 40) {
        mapped.push(article);
      }
    }

    return { articles: mapped };
  } catch {
    return {
      articles: [],
      error: `Network error contacting OpenAlex for ${translated.journal} (${translated.year}).`,
    };
  }
}
