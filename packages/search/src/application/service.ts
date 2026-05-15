// @netea/search/application/service — HybridSearchService driving function.
//
// Composes the lexical + semantic adapters, fuses via RRF, materializes the
// returned `SearchResultItem`s by joining against the enriched_questions table.

import { getDb } from "@netea/db";
import { embed } from "ai";
import type {
  SearchAnswer,
  SearchQuery,
  SearchResult,
  SearchResultItem,
} from "@netea/schemas";
import { rrf, type FusedHit } from "../domain/rrf.js";
import { LexicalSearchAdapter } from "../infrastructure/pg-lexical.js";
import { SemanticSearchAdapter } from "../infrastructure/pg-semantic.js";
import type {
  LexicalSearchPort,
  QueryEmbeddingPort,
  SearchEmbeddingModelInput,
  SemanticSearchPort,
} from "./ports.js";

export type HybridSearchDeps = {
  lexicalAdapter?: LexicalSearchPort;
  semanticAdapter?: SemanticSearchPort;
  queryEmbedding?: QueryEmbeddingPort;
  embeddingModel?: SearchEmbeddingModelInput;
};

type EnrichedRowLite = {
  id: string;
  title: string;
  content: string;
  bloom_level: string;
  medical_specialty: string;
  // `answers` is stored as JSONB; the postgres driver decodes it to JS.
  answers: SearchAnswer[];
  explanation: string;
};

async function loadHydration(ids: string[]): Promise<Map<string, EnrichedRowLite>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const idsLiteral =
    "{" + ids.map((id) => `"${id}"`).join(",") + "}";
  const rows = await db.$client<EnrichedRowLite[]>`
    SELECT id, title, content, bloom_level, medical_specialty, answers, explanation
    FROM enriched_questions
    WHERE id = ANY(${idsLiteral}::uuid[])
  `;
  const map = new Map<string, EnrichedRowLite>();
  for (const row of rows) map.set(row.id, row);
  return map;
}

export async function hybridSearch(
  input: SearchQuery,
  deps?: HybridSearchDeps,
): Promise<SearchResult> {
  const lexical = deps?.lexicalAdapter ?? new LexicalSearchAdapter();
  const semantic = deps?.semanticAdapter ?? new SemanticSearchAdapter();

  const limit = input.limit ?? 5;

  // 1. Get query embedding (optional — when neither dep is configured, semantic leg is skipped).
  let queryVector: number[] | null = null;
  if (deps?.queryEmbedding) {
    const result = await deps.queryEmbedding.embed(input.query);
    queryVector = result.vector;
  } else if (deps?.embeddingModel) {
    const result = await embed({
      model: deps.embeddingModel,
      value: input.query,
    });
    queryVector = result.embedding;
  }

  // 2. Run both legs in parallel.
  const [lexicalHits, semanticHits] = await Promise.all([
    lexical.search({
      query: input.query,
      limit: limit * 3,
      bloom_level: input.bloom_level,
    }),
    queryVector
      ? semantic.search({
          queryVector,
          limit: limit * 3,
          bloom_level: input.bloom_level,
        })
      : Promise.resolve([]),
  ]);

  // 3. Fuse via RRF.
  const fused: FusedHit[] = rrf(lexicalHits, semanticHits);

  const filterApplied = Boolean(input.bloom_level);
  const emptyReason = filterApplied ? "no_match_with_filter" : "no_match";

  if (fused.length === 0) {
    return {
      kind: "no_match",
      results: [],
      reason: emptyReason,
    };
  }

  // 4. Hydrate top-N back from Postgres.
  const topIds = fused.slice(0, limit).map((f) => f.id);
  const hydration = await loadHydration(topIds);
  const results: SearchResultItem[] = [];
  for (const fusedHit of fused.slice(0, limit)) {
    const row = hydration.get(fusedHit.id);
    if (!row) continue;
    // Defense in depth: even if SQL filter were bypassed, drop any row whose
    // bloom_level does not match the requested filter. Guarantees KPI #5:
    // 100% of returned hits match the requested bloom_level when explicit.
    if (input.bloom_level && row.bloom_level !== input.bloom_level) continue;
    results.push({
      id: row.id,
      title: row.title,
      content: row.content,
      bloom_level: row.bloom_level as SearchResultItem["bloom_level"],
      medical_specialty: row.medical_specialty,
      score: fusedHit.score,
      answers: row.answers,
      explanation: row.explanation,
    });
  }

  if (results.length === 0) {
    return { kind: "no_match", results: [], reason: emptyReason };
  }

  return { kind: "results", results, total: results.length };
}

export class HybridSearchService {
  constructor(private readonly _deps: HybridSearchDeps) {}

  async hybridSearch(input: SearchQuery): Promise<SearchResult> {
    return hybridSearch(input, this._deps);
  }
}
