import { describe, expect, it } from "vitest";
import {
  ANALYSIS_CONFIG_STORAGE_KEY,
  MAX_ANALYSIS_INSTRUCTION_CHARS,
  MAX_OUTPUT_SCHEMA_CHARS,
  createEmptyAnalysisDraft,
  loadAnalysisConfig,
  restoreAnalysisDefault,
  saveAnalysisConfig,
  saveAnalysisDefault,
  updateAnalysisDraft,
  type AnalysisDraft,
  type StorageLike
} from "./analysis-config.js";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const draft = (overrides: Partial<AnalysisDraft> = {}): AnalysisDraft => ({
  instruction: "提取商品、价格和首次出现时间",
  suggestionIds: ["extract"],
  outputSchema: '{"items":[{"name":"string","price":0,"atMs":0}]}',
  ...overrides
});

describe("loadAnalysisConfig", () => {
  it("returns an empty versioned draft for an empty store", () => {
    expect(loadAnalysisConfig(new MemoryStorage())).toEqual({
      version: 1,
      draft: createEmptyAnalysisDraft()
    });
  });

  it("loads a valid versioned draft and default", () => {
    const storage = new MemoryStorage();
    const defaultConfig = draft({ instruction: "整理行动项", suggestionIds: ["report"] });
    storage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      draft: draft(),
      defaultConfig
    }));

    expect(loadAnalysisConfig(storage)).toEqual({ version: 1, draft: draft(), defaultConfig });
  });

  it("falls back safely for corrupted JSON, unknown versions, and malformed drafts", () => {
    const storage = new MemoryStorage();
    const empty = { version: 1, draft: createEmptyAnalysisDraft() };

    storage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, "{not-json");
    expect(loadAnalysisConfig(storage)).toEqual(empty);

    storage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, JSON.stringify({ version: 2, draft: draft() }));
    expect(loadAnalysisConfig(storage)).toEqual(empty);

    storage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      draft: { instruction: [], suggestionIds: [], outputSchema: "{}" }
    }));
    expect(loadAnalysisConfig(storage)).toEqual(empty);
  });

  it("does not throw when browser storage is unavailable", () => {
    const storage: StorageLike = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); }
    };

    expect(() => loadAnalysisConfig(storage)).not.toThrow();
    expect(loadAnalysisConfig(storage)).toEqual({ version: 1, draft: createEmptyAnalysisDraft() });
    expect(saveAnalysisConfig(storage, { version: 1, draft: draft() })).toBe(false);
  });

  it("filters invalid suggestion IDs and de-duplicates the allowed IDs", () => {
    const storage = new MemoryStorage();
    storage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      draft: {
        instruction: "组合处理",
        suggestionIds: ["report", "unknown", "extract", "report", 42, "subtitles"],
        outputSchema: "{}"
      }
    }));

    expect(loadAnalysisConfig(storage).draft.suggestionIds).toEqual(["report", "extract", "subtitles"]);
  });

  it("clamps draft and default strings to the server limits", () => {
    const storage = new MemoryStorage();
    storage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      draft: draft({
        instruction: "i".repeat(MAX_ANALYSIS_INSTRUCTION_CHARS + 20),
        outputSchema: "s".repeat(MAX_OUTPUT_SCHEMA_CHARS + 20)
      }),
      defaultConfig: draft({
        instruction: "d".repeat(MAX_ANALYSIS_INSTRUCTION_CHARS + 10),
        outputSchema: "j".repeat(MAX_OUTPUT_SCHEMA_CHARS + 10)
      })
    }));

    const loaded = loadAnalysisConfig(storage);
    expect(loaded.draft.instruction).toHaveLength(MAX_ANALYSIS_INSTRUCTION_CHARS);
    expect(loaded.draft.outputSchema).toHaveLength(MAX_OUTPUT_SCHEMA_CHARS);
    expect(loaded.defaultConfig?.instruction).toHaveLength(MAX_ANALYSIS_INSTRUCTION_CHARS);
    expect(loaded.defaultConfig?.outputSchema).toHaveLength(MAX_OUTPUT_SCHEMA_CHARS);
  });

  it("drops only a malformed optional default while preserving a valid draft", () => {
    const storage = new MemoryStorage();
    storage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      draft: draft(),
      defaultConfig: { instruction: "bad", suggestionIds: "extract", outputSchema: "{}" }
    }));

    expect(loadAnalysisConfig(storage)).toEqual({ version: 1, draft: draft() });
  });
});

describe("analysis configuration updates", () => {
  it("automatically persists draft updates while retaining the saved default", () => {
    const storage = new MemoryStorage();
    const defaultConfig = draft({ instruction: "默认要求", suggestionIds: ["report"] });
    saveAnalysisConfig(storage, { version: 1, draft: defaultConfig, defaultConfig });

    const nextDraft = draft({ instruction: "本次要求", suggestionIds: ["extract", "extract", "invalid" as never] });
    expect(updateAnalysisDraft(storage, nextDraft)).toEqual({
      version: 1,
      draft: draft({ instruction: "本次要求", suggestionIds: ["extract"] }),
      defaultConfig
    });
    expect(loadAnalysisConfig(storage)).toEqual({
      version: 1,
      draft: draft({ instruction: "本次要求", suggestionIds: ["extract"] }),
      defaultConfig
    });
  });

  it("saves the current draft as a reusable default", () => {
    const storage = new MemoryStorage();
    updateAnalysisDraft(storage, draft({ suggestionIds: ["extract", "report"] }));

    const saved = saveAnalysisDefault(storage);
    expect(saved.defaultConfig).toEqual(saved.draft);
    expect(saved.defaultConfig).not.toBe(saved.draft);
    expect(loadAnalysisConfig(storage)).toEqual(saved);
  });

  it("can save an explicitly supplied draft as the default without replacing the active draft", () => {
    const storage = new MemoryStorage();
    updateAnalysisDraft(storage, draft({ instruction: "active" }));
    const selectedDefault = draft({ instruction: "default", suggestionIds: ["subtitles"] });

    expect(saveAnalysisDefault(storage, selectedDefault)).toEqual({
      version: 1,
      draft: draft({ instruction: "active" }),
      defaultConfig: selectedDefault
    });
  });

  it("restores the saved default into the draft and leaves no-default state unchanged", () => {
    const storage = new MemoryStorage();
    const defaultConfig = draft({ instruction: "默认要求", suggestionIds: ["subtitles", "report"] });
    saveAnalysisConfig(storage, {
      version: 1,
      draft: draft({ instruction: "临时要求", suggestionIds: [] }),
      defaultConfig
    });

    expect(restoreAnalysisDefault(storage)).toEqual({ version: 1, draft: defaultConfig, defaultConfig });
    expect(loadAnalysisConfig(storage)).toEqual({ version: 1, draft: defaultConfig, defaultConfig });

    const emptyStorage = new MemoryStorage();
    expect(restoreAnalysisDefault(emptyStorage)).toEqual({ version: 1, draft: createEmptyAnalysisDraft() });
  });

  it("serializes only analysis configuration fields, never source URLs or files", () => {
    const storage = new MemoryStorage();
    const unsafeDraft = {
      ...draft(),
      url: "https://private.example/video.mp4",
      file: { name: "private.mp4", bytes: [1, 2, 3] }
    } as AnalysisDraft;

    expect(saveAnalysisConfig(storage, {
      version: 1,
      draft: unsafeDraft,
      sourceUrl: "https://private.example/other.mp4"
    } as never)).toBe(true);

    const serialized = storage.getItem(ANALYSIS_CONFIG_STORAGE_KEY) ?? "";
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("private.mp4");
    expect(JSON.parse(serialized)).toEqual({ version: 1, draft: draft() });
  });
});
