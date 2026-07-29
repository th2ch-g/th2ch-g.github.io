// Consume a Fetch Response without allowing an unexpectedly large payload to
// be buffered in full. Compression is already decoded by Fetch/Undici, so the
// streaming limit applies to the bytes the caller will actually retain.
export async function readResponseBuffer(
  response,
  maxBytes,
  { allowTruncated = false } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer');
  }

  const declared = response.headers.get('content-length');
  if (
    !allowTruncated
    && declared
    && /^\d+$/.test(declared)
    && Number(declared) > maxBytes
  ) {
    await response.body?.cancel();
    throw new Error(`response body exceeds ${maxBytes} bytes`);
  }

  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);

  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { value, done } = await reader.read();
    if (done) break;

    const remaining = maxBytes - total;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      total += remaining;
      try {
        await reader.cancel();
      } catch {
        // The limit has already been enforced; cancellation is best-effort.
      }
      if (!allowTruncated) {
        throw new Error(`response body exceeds ${maxBytes} bytes`);
      }
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }

  if (total === maxBytes) {
    if (allowTruncated) {
      try {
        await reader.cancel();
      } catch {
        // The limit has already been enforced; cancellation is best-effort.
      }
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    }
    const { value, done } = await reader.read();
    if (!done && value.byteLength > 0) {
      try {
        await reader.cancel();
      } catch {
        // The limit has already been enforced; cancellation is best-effort.
      }
      throw new Error(`response body exceeds ${maxBytes} bytes`);
    }
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}
