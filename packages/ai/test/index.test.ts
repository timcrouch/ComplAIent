import { describe, expect, it } from "vitest";
import * as ai from "../src/index.js";

describe("public entry", () => {
  it("does not expose a way around readiness: no runStructured or OpenRouter builder", () => {
    expect(ai).not.toHaveProperty("runStructured");
    expect(ai).not.toHaveProperty("createOpenRouterProvider");
  });

  it("exposes the gateway, the mock, the secret box, readiness and the Prisma store", () => {
    for (const name of [
      "createGateway",
      "createMockProvider",
      "ProviderError",
      "sealSecret",
      "openSecret",
      "SecretUnreadableError",
      "aiReadiness",
      "MODEL_KEY_BY_PURPOSE",
      "createPrismaAiStore",
    ]) {
      expect(ai).toHaveProperty(name);
    }
  });

  it("exposes local embeddings, retrieval and control suggestions, but not the test embedder", () => {
    for (const name of [
      "createLocalEmbedder",
      "ensureLibraryEmbedded",
      "nearestControls",
      "suggestControlsForRisk",
      "buildControlSuggestionPrompt",
    ]) {
      expect(ai).toHaveProperty(name);
    }
    expect(ai).not.toHaveProperty("createHashEmbedder");
  });
});
