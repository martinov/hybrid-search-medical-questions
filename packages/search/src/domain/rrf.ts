// @netea/search/domain/rrf — Reciprocal Rank Fusion (Cormack et al. 2009).
// Pure function. No I/O.
//
// score(d) = Σ over each leg L in which d appears: 1 / (k + rank_L(d))
// Default k=60 per brief §App Arch 7. Rank is 1-based.

export type Hit = { id: string; rank: number };

export interface FusedHit {
  id: string;
  score: number;
  lexicalRank: number | null;
  semanticRank: number | null;
}

export function rrf(
  lexicalHits: ReadonlyArray<Hit>,
  semanticHits: ReadonlyArray<Hit>,
  k = 60,
): FusedHit[] {
  const map = new Map<string, FusedHit>();
  for (const hit of lexicalHits) {
    const entry = map.get(hit.id) ?? {
      id: hit.id,
      score: 0,
      lexicalRank: null,
      semanticRank: null,
    };
    entry.lexicalRank = hit.rank;
    entry.score += 1 / (k + hit.rank);
    map.set(hit.id, entry);
  }
  for (const hit of semanticHits) {
    const entry = map.get(hit.id) ?? {
      id: hit.id,
      score: 0,
      lexicalRank: null,
      semanticRank: null,
    };
    entry.semanticRank = hit.rank;
    entry.score += 1 / (k + hit.rank);
    map.set(hit.id, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}
