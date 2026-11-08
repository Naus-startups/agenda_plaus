import type { MatchedServiceDTO, PaginationMeta, SearchResultDTO } from "@slotix/types";
import { ValidationError } from "../../shared/errors";
import { compareNearest, compareRecommended, compareTopRated, weightedRating } from "../../shared/utils/ranking";
import { parseSearchQuery, searchableText, termMatches, type SearchTerm } from "../../shared/utils/textMatch";
import { toBusinessDTO, type Coordinates } from "../businesses";
import { searchRepository } from "./search.repository";
import type { SearchQueryInput } from "./search.schema";

interface ServiceLike {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: { toNumber(): number };
}

interface BusinessLike {
  name: string;
  description: string | null;
  category: string | null;
  address: string | null;
  bairro: string | null;
  municipio: string | null;
  provincia: string | null;
  services: ServiceLike[];
}

// How strongly a field says "this place does what was asked": a service named for it
// beats a business that only mentions it somewhere in its description.
const WEIGHT = { serviceName: 5, serviceCategory: 4, businessCategory: 4, businessName: 3, place: 3, serviceDescription: 2, businessDescription: 1 };

interface Relevance {
  /** How many of the query's terms the business answers. */
  coverage: number;
  /** The sum, per term, of the strongest field it was found in. */
  score: number;
}

function relevanceOf(terms: SearchTerm[], business: BusinessLike): Relevance {
  const fields: [string, number][] = [
    [searchableText(business.name), WEIGHT.businessName],
    [searchableText(business.category), WEIGHT.businessCategory],
    [searchableText(business.description), WEIGHT.businessDescription],
    [searchableText(business.address, business.bairro, business.municipio, business.provincia), WEIGHT.place],
    ...business.services.flatMap((service): [string, number][] => [
      [searchableText(service.name), WEIGHT.serviceName],
      [searchableText(service.category), WEIGHT.serviceCategory],
      [searchableText(service.description), WEIGHT.serviceDescription],
    ]),
  ];

  let coverage = 0;
  let score = 0;
  for (const term of terms) {
    const best = Math.max(0, ...fields.filter(([text]) => termMatches(term, text)).map(([, weight]) => weight));
    if (best > 0) {
      coverage += 1;
      score += best;
    }
  }
  return { coverage, score };
}

// The service that answers the most terms (its name counting most) wins; ties — including
// "none at all", when the business matched by its own name or place — go to the cheapest
// active service, as a representative starting price.
function pickMatchedService(terms: SearchTerm[], services: ServiceLike[]): MatchedServiceDTO | null {
  let best: ServiceLike | null = null;
  let bestScore = -1;

  for (const service of services) {
    const name = searchableText(service.name);
    const category = searchableText(service.category);
    const description = searchableText(service.description);
    const score = terms.reduce(
      (sum, term) => sum + (termMatches(term, name) ? 3 : termMatches(term, category) ? 2 : termMatches(term, description) ? 1 : 0),
      0,
    );
    const currentBestPrice = best?.price.toNumber() ?? Infinity;
    if (score > bestScore || (score === bestScore && service.price.toNumber() < currentBestPrice)) {
      best = service;
      bestScore = score;
    }
  }

  if (!best) return null;
  return { id: best.id, name: best.name, price: best.price.toNumber() };
}

interface ScoredResult {
  result: SearchResultDTO;
  relevance: Relevance;
}

function priceOrInfinity(result: SearchResultDTO): number {
  return result.matchedService?.price ?? Infinity;
}

// "recommended" puts what answers the request best first, and only then the best-rated and
// nearest among equally good answers. The other modes sort by exactly the one dimension
// their name promises — no hidden blending — reusing the comparators `businesses.list`
// offers (shared/utils/ranking.ts); "bestPrice" is search-only, since it depends on the
// matchedService concept.
function sortResults(results: ScoredResult[], sortBy: SearchQueryInput["sortBy"]): SearchResultDTO[] {
  const scored = results.map(({ result, relevance }) => ({
    result,
    relevance,
    score: weightedRating(result.business.ratingAvg, result.business.ratingCount),
    distanceKm: result.business.distanceKm,
    ratingCount: result.business.ratingCount,
  }));

  switch (sortBy) {
    case "nearest":
      return scored.sort(compareNearest).map((entry) => entry.result);

    case "bestPrice":
      return scored.sort((a, b) => priceOrInfinity(a.result) - priceOrInfinity(b.result)).map((entry) => entry.result);

    case "topRated":
      return scored.sort(compareTopRated).map((entry) => entry.result);

    case "recommended":
    default:
      return scored
        .sort(
          (a, b) =>
            b.relevance.coverage - a.relevance.coverage ||
            b.relevance.score - a.relevance.score ||
            compareRecommended(a, b),
        )
        .map((entry) => entry.result);
  }
}

export const searchService = {
  async search(query: SearchQueryInput): Promise<{ data: SearchResultDTO[]; meta: PaginationMeta }> {
    if (query.sortBy === "nearest" && (query.latitude === undefined || query.longitude === undefined)) {
      throw new ValidationError("latitude e longitude são obrigatórias para ordenar por 'nearest'.", "SEARCH_LOCATION_REQUIRED");
    }

    const terms = parseSearchQuery(query.q);
    // Only request words ("quero fazer…"): nothing to look for yet, so nothing found —
    // not an error, since this is what someone mid-sentence sends.
    if (terms.length === 0) {
      if (query.q.trim().length === 0) throw new ValidationError("Termo de pesquisa inválido.", "SEARCH_INVALID_QUERY");
      return { data: [], meta: { page: query.page, limit: query.limit, total: 0 } };
    }

    const viewerCoords: Coordinates | undefined =
      query.latitude !== undefined && query.longitude !== undefined ? { latitude: query.latitude, longitude: query.longitude } : undefined;

    const candidates = await searchRepository.findCandidates([...new Set(terms.flatMap((term) => term.patterns))]);

    const scored = candidates
      .map((business) => ({ business, relevance: relevanceOf(terms, business) }))
      .filter(({ relevance }) => relevance.coverage > 0);

    // Places that answer only a small part of the request ("tempos" of "corte 2 tempos" is not
    // a reason to show a spa) are left out once others answer most of it.
    const bestCoverage = Math.max(0, ...scored.map(({ relevance }) => relevance.coverage));
    const minCoverage = Math.max(1, Math.ceil(bestCoverage / 2));

    const results: ScoredResult[] = scored
      .filter(({ relevance }) => relevance.coverage >= minCoverage)
      .map(({ business, relevance }) => ({
        result: { business: toBusinessDTO(business, viewerCoords), matchedService: pickMatchedService(terms, business.services) },
        relevance,
      }));

    const sorted = sortResults(results, query.sortBy);

    const total = sorted.length;
    const start = (query.page - 1) * query.limit;
    const page = sorted.slice(start, start + query.limit);

    return { data: page, meta: { page: query.page, limit: query.limit, total } };
  },
};
