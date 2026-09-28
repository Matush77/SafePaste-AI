// Downloads for the optional name model, pinned to one revision and checked
// against known SHA-256 hashes. Installed as transformers.js' fetch, so the
// library can only ever load the exact files that were evaluated and tested.
//
// Bytes are passed through as they arrive (the popup shows download
// progress), and the stream fails at the end if the size or hash is wrong.
// transformers.js caches a file only after reading it successfully, so a
// file that fails the check is neither used nor cached.

import { NAME_MODEL_FILES, NAME_MODEL_ID, NAME_MODEL_REVISION } from "../shared/nameModel.js";

/**
 * @typedef {{ sha256: string, size: number }} ExpectedFile
 * @typedef {(input: string | URL, init?: RequestInit) => Promise<Response>} Fetch
 */

/**
 * @param {{ fetch?: Fetch, files?: Record<string, ExpectedFile>, prefix?: string }} [options]
 *   Defaults to the real fetch and the pinned name model; tests pass their own.
 * @returns {Fetch}
 */
export function createVerifiedFetch({
  fetch: baseFetch = (input, init) => fetch(input, init),
  files = NAME_MODEL_FILES,
  prefix = `https://huggingface.co/${NAME_MODEL_ID}/resolve/${NAME_MODEL_REVISION}/`
} = {}) {
  return async function verifiedFetch(input, init) {
    const url = String(input);
    if (!url.startsWith(prefix)) {
      throw new Error(`Refusing to download ${url}: only the pinned name model may be downloaded.`);
    }
    const path = url.slice(prefix.length);
    const expected = Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined;
    if (!expected) {
      // Optional files the library probes for; the pinned model has none.
      return new Response(null, { status: 404, statusText: "Not part of the pinned model" });
    }

    const response = await baseFetch(url, init);
    if (!response.ok || !response.body) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set("content-length", String(expected.size));
    return new Response(verifiedStream(response.body, expected, path), { status: response.status, statusText: response.statusText, headers });
  };
}

/**
 * @param {ReadableStream<Uint8Array>} source
 * @param {ExpectedFile} expected
 * @param {string} path
 * @returns {ReadableStream<Uint8Array>}
 */
function verifiedStream(source, expected, path) {
  const reader = source.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  const failure = () => new Error(`The name model file ${path} failed its integrity check, so it was not used.`);

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (!done) {
        size += value.byteLength;
        if (size > expected.size) {
          reader.cancel().catch(() => {});
          controller.error(failure());
          return;
        }
        chunks.push(value);
        controller.enqueue(value);
        return;
      }
      if (size !== expected.size || (await sha256Hex(chunks, size)) !== expected.sha256) {
        controller.error(failure());
        return;
      }
      controller.close();
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

/**
 * @param {Uint8Array[]} chunks
 * @param {number} size
 */
async function sha256Hex(chunks, size) {
  const whole = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", whole));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
