// @netea/search/application/ports — Driven-port interfaces.

import type { Hit } from "../domain/rrf.js";
import type { EmbeddingModel } from "ai";

export const __SCAFFOLD__ = true as const;

export interface LexicalSearchPort {
  search(args: {
    query: string;
    limit: number;
    bloom_level?: string;
  }): Promise<Hit[]>;
}

export interface SemanticSearchPort {
  search(args: {
    queryVector: number[];
    limit: number;
    bloom_level?: string;
  }): Promise<Hit[]>;
}

export interface QueryEmbeddingPort {
  embed(text: string): Promise<{ vector: number[] }>;
}

export type SearchEmbeddingModelInput = EmbeddingModel;
