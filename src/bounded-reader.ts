import { StringDecoder } from 'node:string_decoder';
import type { LoadResult } from './types.js';
import { sanitizeMarkdownText } from './utils.js';

/** Adapters own their handles; this collector only admits a bounded byte prefix. */
export async function readBoundedBytes(
  read: (maxBytes: number) => Promise<Uint8Array | undefined>,
  displayName: string,
  maxInputBytes: number,
): Promise<LoadResult> {
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 0) {
    throw new Error('maxInputBytes must be a non-negative safe integer');
  }

  const decoder = new StringDecoder('utf8');
  const pieces: string[] = [];
  let bytesRead = 0;
  let outputBytes = 0;
  let outputFull = false;
  let truncated = false;

  while (true) {
    // The extra byte distinguishes exact EOF from a truncated input.
    const chunk = await read(Math.min(64 * 1024, maxInputBytes - bytesRead + 1));
    if (chunk === undefined) break;
    const admitted = chunk.subarray(0, maxInputBytes - bytesRead);
    bytesRead += admitted.byteLength;
    const decoded = decoder.write(Buffer.from(admitted.buffer, admitted.byteOffset, admitted.byteLength));
    if (!outputFull && decoded) {
      // Malformed UTF-8 may expand into three-byte replacement characters.
      // Keep only a complete-code-point prefix within the same output budget.
      let end = 0;
      for (const point of decoded) {
        const size = Buffer.byteLength(point);
        if (outputBytes + size > maxInputBytes) {
          outputFull = true;
          break;
        }
        outputBytes += size;
        end += point.length;
      }
      if (end) pieces.push(decoded.slice(0, end));
    }
    if (chunk.byteLength > admitted.byteLength) {
      truncated = true;
      break;
    }
  }

  // Do not call decoder.end(): an incomplete terminal character has no valid
  // complete prefix, whether caused by the cap or by incomplete source bytes.
  return {
    text: sanitizeMarkdownText(pieces.join('')),
    displayName,
    bytesRead,
    warning: truncated ? `Input truncated to ${maxInputBytes} bytes` : undefined,
  };
}
