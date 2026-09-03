import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup: string[] = [];

afterEach(async () => {
  await (await import("../persistence/database.js")).closeDatabase();
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function prepareRuntime() {
  const root = await mkdtemp(join(os.tmpdir(), "koma-provider-test-"));
  cleanup.push(root);
  vi.stubEnv("DB_DRIVER", "sqlite");
  vi.stubEnv("KOMA_DATABASE_PATH", join(root, "koma.sqlite"));
  vi.stubEnv("ADMIN_PASSWORD", "admin-password");
  vi.stubEnv("KOMA_CONFIG_SECRET", "stable-encryption-secret");
  vi.stubEnv("ASR_PROVIDER", "mock");
  vi.stubEnv("VISION_PROVIDER", "mock");
  vi.resetModules();
  const runtime = await import("./provider-runtime.js");
  await runtime.initializeProviderSettings();
  return { root, runtime };
}

describe("runtime provider settings", () => {
  it("encrypts provider credentials and rejects the wrong decryption key", async () => {
    const { runtime } = await prepareRuntime();
    const settings = { version: 1 as const, updatedAt: 1000, source: "admin" as const, providers: {
      asr: { provider: "groq" as const, apiKey: "secret-groq-key", baseUrl: "https://api.groq.com/openai/v1", model: "whisper" },
      vision: { provider: "mock" as const, apiKey: "", baseUrl: "", model: "" }
    } };
    const encrypted = runtime.encryptSettings(settings, "encryption-key");
    expect(JSON.stringify(encrypted)).not.toContain("secret-groq-key");
    expect(runtime.decryptSettings(encrypted, "encryption-key")).toEqual(settings);
    expect(() => runtime.decryptSettings(encrypted, "wrong-key")).toThrow();
  });

  it("persists an encrypted admin selection and only returns a masked key", async () => {
    const { root, runtime } = await prepareRuntime();
    const safe = await runtime.updateProviderSettings({
      asr: { provider: "groq", apiKey: "groq-secret-1234", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" },
      vision: { provider: "openrouter", apiKey: "openrouter-secret-5678", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free" }
    });
    expect(safe.source).toBe("admin");
    expect(safe.providers.asr).toMatchObject({ provider: "groq", keyConfigured: true, keyHint: "••••1234" });
    expect(JSON.stringify(safe)).not.toContain("groq-secret-1234");
    const bytes = await readFile(join(root, "koma.sqlite"));
    expect(bytes.toString("utf8")).not.toContain("groq-secret-1234");

    const database = await import("../persistence/database.js");
    await database.closeDatabase();
    vi.resetModules();
    const reloaded = await import("./provider-runtime.js");
    await reloaded.initializeProviderSettings();
    expect(reloaded.getRuntimeProviders().vision).toMatchObject({ provider: "openrouter", apiKey: "openrouter-secret-5678" });
    await (await import("../persistence/database.js")).closeDatabase();
  });
});
