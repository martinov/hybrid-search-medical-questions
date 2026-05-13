// tests/_helpers/chat-mocks.ts — Slice 04/05/06 chat-stream mocks.

import { MockLanguageModelV1 } from "ai/test";

export const __SCAFFOLD__ = true as const;

export function makeToolCallSpy(): {
  callsForTurn: (n: number) => Array<{ query: string }>;
} {
  throw new Error("Not yet implemented — RED scaffold");
}

export function streamingAgentReplyApplicationOnly(): {
  stream: ReadableStream;
  rawCall: { rawPrompt: null; rawSettings: object };
} {
  throw new Error("Not yet implemented — RED scaffold");
}

export function streamingAgentReplyEmptyFilteredOffersAdjacent(): {
  stream: ReadableStream;
  rawCall: { rawPrompt: null; rawSettings: object };
} {
  throw new Error("Not yet implemented — RED scaffold");
}

export function honestEmptyAgentMock(): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function clarificationAgentMock(): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function honestEmptyUnderPressureMock(): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function optInReformulationMock(
  _spy: ReturnType<typeof makeToolCallSpy>,
): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function openSecondPriorResultMock(
  _spy: ReturnType<typeof makeToolCallSpy>,
): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function filterPriorByApplicationMock(
  _spy: ReturnType<typeof makeToolCallSpy>,
): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function topicShiftToDkaMock(
  _spy: ReturnType<typeof makeToolCallSpy>,
): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function normalReplyMock(): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function outOfRangeOrdinalMock(): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function buildHeartFailureHistory(
  _turns: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  throw new Error("Not yet implemented — RED scaffold");
}
