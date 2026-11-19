import { CapabilityAuthError } from "./guestCapability";

const MAX_JSON_BYTES = 8 * 1024;

export async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > MAX_JSON_BYTES) {
    throw new CapabilityAuthError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 8 KiB.");
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_JSON_BYTES);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > bytes.length) {
        void reader.cancel().catch(() => {});
        throw new CapabilityAuthError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 8 KiB.");
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  let parsed: unknown;
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    parsed = body.trim() ? JSON.parse(body) : {};
  } catch {
    throw new CapabilityAuthError(400, "INVALID_JSON", "Request body must be valid UTF-8 JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CapabilityAuthError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
