/** Zero-copy hand-off of Buffers across the worker boundary. */

/**
 * A Uint8Array that may be transferred (detached from the caller) without corrupting anything.
 *
 * A Buffer that spans its whole ArrayBuffer is moved as-is. Pooled slices (small `Buffer`s share
 * one 8 KiB pool) and views over shared memory are copied, since transferring them would detach
 * unrelated data.
 */
export function toTransferable(buffer: Uint8Array): Uint8Array {
  const { buffer: backing, byteOffset, byteLength } = buffer;
  const owns =
    backing instanceof ArrayBuffer && byteOffset === 0 && byteLength === backing.byteLength;
  return owns ? buffer : Uint8Array.from(buffer);
}

/** Wrap bytes received from a worker as a Buffer without copying. */
export function fromTransferred(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
