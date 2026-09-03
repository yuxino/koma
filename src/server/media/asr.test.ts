import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compactTranscriptText, groupWordsToSubtitles, requestOpenAICompatibleSubtitle, requestSegmentSubtitle, transcribe } from "./asr.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Fun-ASR subtitle adapter", () => {
  it("compacts repeated filler sounds before displaying them", () => {
    expect(compactTranscriptText("  哦哦哦哦哦哦   哎哎哎！！！继续说话。  ")).toBe("哦… 哎…！继续说话。");
  });

  it("sends a base64 MP3 to the native multimodal endpoint and returns sentence lines", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-asr-test-"));
    tempDirs.push(dir);
    const path = join(dir, "segment-000.mp3");
    await writeFile(path, Buffer.from([0x49, 0x44, 0x33, 0x04]));
    let captured;

    const lines = await requestSegmentSubtitle({
      segment: { path, startMs: 0, endMs: 60000 },
      apiKey: "test-key",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "fun-asr-flash-2026-06-15",
      fetchImpl: async (url, options) => {
        captured = { url, options, body: JSON.parse(options.body) };
        return new Response(JSON.stringify({
          output: {
            output: {
              sentence: {
                text: "第一句。 第二句。",
                words: [
                  { begin_time: 0, end_time: 500, text: " 第一句", punctuation: "" },
                  { begin_time: 500, end_time: 1000, text: "。", punctuation: "。" },
                  { begin_time: 2000, end_time: 2500, text: " 第二句", punctuation: "" },
                  { begin_time: 2500, end_time: 3000, text: "。", punctuation: "。" }
                ]
              }
            }
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(captured.url).toBe("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
    expect(captured.options.headers.Authorization).toBe("Bearer test-key");
    expect(captured.body.model).toBe("fun-asr-flash-2026-06-15");
    expect(captured.body.parameters.format).toBe("mp3");
    expect(captured.body.input.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/mpeg;base64,/);
    expect(lines).toEqual([
      { startMs: 0, endMs: 1000, text: "第一句。" },
      { startMs: 2000, endMs: 3000, text: "第二句。" }
    ]);
  });

  it("adds the segment offset back onto subtitle lines", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-asr-test-"));
    tempDirs.push(dir);
    const path = join(dir, "segment-000.mp3");
    await writeFile(path, "audio");

    const lines = await transcribe({
      audioSegments: [{ path, startMs: 30_000, endMs: 90_000 }],
      durationMs: 90_000,
      provider: "dashscope",
      apiKey: "test-key",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "fun-asr-flash-2026-06-15",
      fetchImpl: async () => new Response(JSON.stringify({
        output: { output: { sentence: { text: "测试。", words: [{ begin_time: 0, end_time: 400, text: " 测试", punctuation: "。" }] } } }
      }), { status: 200, headers: { "content-type": "application/json" } })
    });

    expect(lines[0].startMs).toBe(30_000);
    expect(lines[0].endMs).toBe(30_400);
  });

  it("falls back to one line when the model returns no word timestamps", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-asr-test-"));
    tempDirs.push(dir);
    const path = join(dir, "segment-000.mp3");
    await writeFile(path, "audio");

    const lines = await requestSegmentSubtitle({
      segment: { path, startMs: 5000, endMs: 9000 },
      apiKey: "test-key",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "fun-asr-flash-2026-06-15",
      fetchImpl: async () => new Response(JSON.stringify({
        output: { output: { sentence: { text: "只有整句没有词级时间戳。" } } }
      }), { status: 200, headers: { "content-type": "application/json" } })
    });

    expect(lines).toEqual([{ startMs: 5000, endMs: 9000, text: "只有整句没有词级时间戳。" }]);
  });

  it("surfaces the provider error without leaking the API key", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-asr-test-"));
    tempDirs.push(dir);
    const path = join(dir, "segment-000.mp3");
    await writeFile(path, "audio");

    await expect(requestSegmentSubtitle({
      segment: { path, startMs: 0, endMs: 1000 },
      apiKey: "secret-key",
      baseUrl: "https://example.com/v1",
      model: "fun-asr-flash-2026-06-15",
      fetchImpl: async () => new Response(JSON.stringify({ message: "免费额度已用完" }), {
        status: 429,
        headers: { "content-type": "application/json" }
      })
    })).rejects.toThrow("免费额度已用完");
  });
});

describe("OpenAI-compatible subtitle adapter", () => {
  it("posts multipart audio and converts second timestamps to milliseconds", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-openai-asr-test-"));
    tempDirs.push(dir);
    const path = join(dir, "segment-000.mp3");
    await writeFile(path, Buffer.from([0x49, 0x44, 0x33, 0x04]));
    let captured: { url: string; options: RequestInit } | undefined;

    const lines = await requestOpenAICompatibleSubtitle({
      segment: { path, startMs: 0, endMs: 60_000 },
      apiKey: "groq-test-key",
      baseUrl: "https://api.groq.com/openai/v1/",
      model: "whisper-large-v3-turbo",
      fetchImpl: async (url, options) => {
        captured = { url: String(url), options: options || {} };
        return new Response(JSON.stringify({
          text: "第一句。第二句。",
          segments: [
            { start: 0.25, end: 1.5, text: " 第一句。 " },
            { start: 2, end: 3.125, text: "第二句。" }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(captured?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((captured?.options.headers as Record<string, string>).Authorization).toBe("Bearer groq-test-key");
    const form = captured?.options.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(lines).toEqual([
      { startMs: 250, endMs: 1500, text: "第一句。" },
      { startMs: 2000, endMs: 3125, text: "第二句。" }
    ]);
  });

  it("adds chunk offsets for Groq/OpenAI-compatible providers", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-openai-asr-test-"));
    tempDirs.push(dir);
    const path = join(dir, "segment-001.mp3");
    await writeFile(path, "audio");

    const lines = await transcribe({
      audioSegments: [{ path, startMs: 60_000, endMs: 120_000 }],
      provider: "groq",
      apiKey: "key",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3-turbo",
      fetchImpl: async () => new Response(JSON.stringify({
        segments: [{ start: 1, end: 2.5, text: "带偏移的字幕" }]
      }), { status: 200, headers: { "content-type": "application/json" } })
    });

    expect(lines).toEqual([{ startMs: 61_000, endMs: 62_500, text: "带偏移的字幕" }]);
  });
});

describe("groupWordsToSubtitles", () => {
  it("breaks lines on terminal punctuation", () => {
    const lines = groupWordsToSubtitles([
      { begin_time: 0, end_time: 500, text: " 你好", punctuation: "" },
      { begin_time: 500, end_time: 900, text: "。", punctuation: "。" },
      { begin_time: 1200, end_time: 1700, text: " 再见", punctuation: "" },
      { begin_time: 1700, end_time: 2000, text: "！", punctuation: "！" }
    ]);
    expect(lines).toEqual([
      { startMs: 0, endMs: 900, text: "你好。" },
      { startMs: 1200, endMs: 2000, text: "再见！" }
    ]);
  });

  it("breaks lines on long pauses and caps line length", () => {
    const lines = groupWordsToSubtitles([
      { begin_time: 0, end_time: 500, text: " 第一", punctuation: "" },
      { begin_time: 3500, end_time: 4000, text: " 第二", punctuation: "" }
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("第一");
    expect(lines[1].text).toBe("第二");
  });

  it("keeps one continuous line when nothing splits it", () => {
    const lines = groupWordsToSubtitles([
      { begin_time: 0, end_time: 300, text: " 一", punctuation: "" },
      { begin_time: 300, end_time: 600, text: " 二", punctuation: "" },
      { begin_time: 600, end_time: 900, text: " 三", punctuation: "" }
    ]);
    expect(lines).toEqual([{ startMs: 0, endMs: 900, text: "一 二 三" }]);
  });
});

describe("diarization result parsing", () => {
  it("maps async task sentences into speaker-labelled subtitle lines", async () => {
    const task = {
      output: {
        results: [
          { subtask_status: "SUCCEEDED", transcription_url: "https://example.com/result.json" },
          { subtask_status: "FAILED", message: "忽略这个失败的子任务" }
        ]
      }
    };
    const { parseDiarizationTask } = await import("./asr.js");
    const lines = await parseDiarizationTask(task, {
      apiKey: "test-key",
      timeoutMs: 5000,
      fetchImpl: async () => new Response(JSON.stringify({
        transcripts: [{
          sentences: [
            { begin_time: 0, end_time: 3200, text: "你好，这里是甲。", speaker_id: 0 },
            { begin_time: 3500, end_time: 6100, text: "我是乙。", speaker_id: 1 }
          ]
        }]
      }), { status: 200, headers: { "content-type": "application/json" } })
    });
    expect(lines).toEqual([
      { startMs: 0, endMs: 3200, text: "你好，这里是甲。", speaker: "0" },
      { startMs: 3500, endMs: 6100, text: "我是乙。", speaker: "1" }
    ]);
  });

  it("throws when every subtask failed", async () => {
    const { parseDiarizationTask } = await import("./asr.js");
    await expect(parseDiarizationTask({
      output: { results: [{ subtask_status: "FAILED", message: "音频无法下载" }] }
    }, { apiKey: "k", timeoutMs: 1000 })).rejects.toThrow("音频无法下载");
  });
});

describe("no-speech segments", () => {
  it("skips a segment the ASR rejects as having no words", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const os = await import("node:os");
    const dir = await mkdtemp(join(os.tmpdir(), "koma-asr-nospeech-"));
    try {
      const path = join(dir, "segment-006.mp3");
      await writeFile(path, "audio");
      const lines = await requestSegmentSubtitle({
        segment: { path, startMs: 360_000, endMs: 420_000 },
        apiKey: "test-key",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "fun-asr-flash-2026-06-15",
        fetchImpl: async () => new Response(JSON.stringify({ code: "ASR_RESPONSE_HAVE_NO_WORDS" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        })
      });
      expect(lines).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
