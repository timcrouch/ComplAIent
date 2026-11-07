import { randomUUID } from "node:crypto";
import {
  defaultAiSettings,
  type AiOutcome,
  type AiSettingsRow,
  type AiStore,
  type InteractionRecord,
} from "./store.js";

export type MemoryAiStore = AiStore & {
  settings: AiSettingsRow;
  interactions: (InteractionRecord & { id: string; outcome: AiOutcome; discardedCount: number })[];
};

/** In-memory AiStore for unit tests. */
export function createMemoryAiStore(settings: AiSettingsRow = defaultAiSettings()): MemoryAiStore {
  const store: MemoryAiStore = {
    settings,
    interactions: [],
    loadSettings: () => Promise.resolve(store.settings),
    recordInteraction(r) {
      const id = randomUUID();
      store.interactions.push({ ...structuredClone(r), id, outcome: "none", discardedCount: 0 });
      return Promise.resolve(id);
    },
    setOutcome(id, outcome) {
      const row = store.interactions.find((i) => i.id === id);
      if (!row) return Promise.reject(new Error("unknown interaction"));
      row.outcome = outcome;
      return Promise.resolve();
    },
    setDiscardedCount(id, count) {
      const row = store.interactions.find((i) => i.id === id);
      if (!row) return Promise.reject(new Error("unknown interaction"));
      if (!Number.isInteger(count) || count < 0) {
        return Promise.reject(new Error("discardedCount must be a non-negative integer"));
      }
      row.discardedCount = count;
      return Promise.resolve();
    },
  };
  return store;
}

export { createHashEmbedder } from "./embedder.js";
