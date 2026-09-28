// The name model may only be downloaded from its pinned revision, and a file
// whose size or hash does not match must never reach the model runtime.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createVerifiedFetch } from "../../src/ner/verifiedFetch.js";
import { NAME_MODEL_FILES, NAME_MODEL_ID, NAME_MODEL_REVISION } from "../../src/shared/nameModel.js";

const PREFIX = "https://models.test/repo/resolve/abc123/";
const GOOD = new TextEncoder().encode("the pinned model weights");
const FILES = { "onnx/model.onnx": { sha256: createHash("sha256").update(GOOD).digest("hex"), size: GOOD.byteLength } };

/**
 * A fetch that serves `bytes` in small chunks and records the URLs it saw.
 * @param {Uint8Array} bytes
 */
function serving(bytes) {
  /** @type {string[]} */
  const requested = [];
  const fetch = async (/** @type {string | URL} */ input) => {
    requested.push(String(input));
    let offset = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + 5));
        offset += 5;
      }
    });
    return new Response(body, { status: 200 });
  };
  return { fetch, requested };
}

describe("verified name model download", () => {
  it("passes through a file whose size and hash match", async () => {
    const { fetch } = serving(GOOD);
    const verified = createVerifiedFetch({ fetch, files: FILES, prefix: PREFIX });
    const response = await verified(`${PREFIX}onnx/model.onnx`);
    expect(response.headers.get("content-length")).toBe(String(GOOD.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(GOOD);
  });

  it("fails the download when the content differs", async () => {
    const tampered = GOOD.slice();
    tampered[3] ^= 1;
    const verified = createVerifiedFetch({ fetch: serving(tampered).fetch, files: FILES, prefix: PREFIX });
    const response = await verified(`${PREFIX}onnx/model.onnx`);
    await expect(response.arrayBuffer()).rejects.toThrow(/integrity check/);
  });

  it("fails the download when the file is shorter or longer", async () => {
    for (const bytes of [GOOD.slice(0, -1), new Uint8Array([...GOOD, 0])]) {
      const verified = createVerifiedFetch({ fetch: serving(bytes).fetch, files: FILES, prefix: PREFIX });
      const response = await verified(`${PREFIX}onnx/model.onnx`);
      await expect(response.arrayBuffer()).rejects.toThrow(/integrity check/);
    }
  });

  it("refuses other repositories and revisions", async () => {
    const { fetch, requested } = serving(GOOD);
    const verified = createVerifiedFetch({ fetch, files: FILES, prefix: PREFIX });
    await expect(verified("https://models.test/repo/resolve/main/onnx/model.onnx")).rejects.toThrow(/pinned/);
    await expect(verified("https://evil.test/onnx/model.onnx")).rejects.toThrow(/pinned/);
    expect(requested).toEqual([]);
  });

  it("answers files outside the pinned set with 404 without downloading", async () => {
    const { fetch, requested } = serving(GOOD);
    const verified = createVerifiedFetch({ fetch, files: FILES, prefix: PREFIX });
    expect((await verified(`${PREFIX}generation_config.json`)).status).toBe(404);
    expect((await verified(`${PREFIX}__proto__`)).status).toBe(404);
    expect(requested).toEqual([]);
  });

  it("passes HTTP errors through for the library to report", async () => {
    const verified = createVerifiedFetch({ fetch: async () => new Response("gone", { status: 503 }), files: FILES, prefix: PREFIX });
    expect((await verified(`${PREFIX}onnx/model.onnx`)).status).toBe(503);
  });

  it("pins the shipped model to a full commit hash with every file it loads", () => {
    expect(NAME_MODEL_REVISION).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(NAME_MODEL_FILES).sort()).toEqual(["config.json", "onnx/model_quantized.onnx", "tokenizer.json", "tokenizer_config.json"]);
    for (const file of Object.values(NAME_MODEL_FILES)) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(NAME_MODEL_ID).toBe("onnx-community/distilbert-NER-ONNX");
  });
});
