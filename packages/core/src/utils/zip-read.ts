/**
 * Defensive in-memory zip reader for untrusted archives.
 *
 * Reads the central directory of a buffered archive and inflates entries
 * lazily, enforcing entry-count, per-entry and total size limits before any
 * decompression (zip-bomb guard) and verifying each entry's CRC. Entry names
 * that could traverse paths are rejected outright. Supports STORE and
 * DEFLATE; rejects encryption, multi-disk and zip64 archives.
 */
import { Buffer } from "node:buffer";
import { crc32, inflateRawSync } from "node:zlib";

/** Limits applied while reading an archive. */
export interface ZipReadLimits {
  /** Maximum number of entries in the central directory. */
  maxEntries: number;
  /** Maximum uncompressed size of one entry, in bytes. */
  maxEntryBytes: number;
  /** Maximum combined uncompressed size of all entries, in bytes. */
  maxTotalBytes: number;
}

/** One file in an archive; `read()` inflates and CRC-checks it. */
export interface ZipEntry {
  name: string;
  size: number;
  read: () => Buffer;
}

/** A malformed, unsafe, or over-limit archive. */
export class ZipFormatError extends Error {
  override readonly name = "ZipFormatError";
}

/**
 * Index the file entries of `archive` by name (directories are skipped).
 *
 * @throws {ZipFormatError} On malformed, unsafe, or over-limit archives.
 */
export function readZip(archive: Buffer, limits: ZipReadLimits): Map<string, ZipEntry> {
  const end = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  if (count > limits.maxEntries) {
    throw new ZipFormatError(`Archive has more than ${limits.maxEntries} entries`);
  }
  const records = readCentralDirectory(archive, archive.readUInt32LE(end + 16), count);
  const total = records.reduce((sum, record) => sum + record.size, 0);
  if (total > limits.maxTotalBytes) {
    throw new ZipFormatError(`Archive expands beyond ${limits.maxTotalBytes} bytes`);
  }
  return indexEntries(archive, records, limits.maxEntryBytes);
}

/** Central-directory fields needed to extract an entry. */
interface CentralRecord {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const EOCD_SIGNATURE = 0x06_05_4b_50;
const CENTRAL_SIGNATURE = 0x02_01_4b_50;
const LOCAL_SIGNATURE = 0x04_03_4b_50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xff_ff;
const STORE = 0;
const DEFLATE = 8;

function fail(message: string): never {
  throw new ZipFormatError(message);
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const floor = Math.max(0, archive.length - EOCD_SIZE - MAX_COMMENT);
  for (let at = archive.length - EOCD_SIZE; at >= floor; at -= 1) {
    if (archive.readUInt32LE(at) === EOCD_SIGNATURE) {
      assertSingleDisk(archive, at);
      return at;
    }
  }
  return fail("Not a zip archive (no end of central directory)");
}

function assertSingleDisk(archive: Buffer, end: number): void {
  const multiDisk = archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0;
  const entriesMismatch = archive.readUInt16LE(end + 8) !== archive.readUInt16LE(end + 10);
  if (multiDisk || entriesMismatch || archive.readUInt32LE(end + 16) === 0xff_ff_ff_ff) {
    fail("Multi-disk and zip64 archives are not supported");
  }
}

function readCentralDirectory(archive: Buffer, start: number, count: number): CentralRecord[] {
  const records: CentralRecord[] = [];
  let at = start;
  for (let index = 0; index < count; index += 1) {
    const { record, next } = readCentralRecord(archive, at);
    records.push(record);
    at = next;
  }
  return records;
}

function readCentralRecord(archive: Buffer, at: number): { record: CentralRecord; next: number } {
  assertRange(archive, at, 46);
  if (archive.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
    fail("Corrupt central directory");
  }
  const nameLength = archive.readUInt16LE(at + 28);
  const extras = archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
  assertRange(archive, at + 46, nameLength);
  const record: CentralRecord = {
    name: archive.toString("utf8", at + 46, at + 46 + nameLength),
    method: archive.readUInt16LE(at + 10),
    flags: archive.readUInt16LE(at + 8),
    crc: archive.readUInt32LE(at + 16),
    compressedSize: archive.readUInt32LE(at + 20),
    size: archive.readUInt32LE(at + 24),
    localOffset: archive.readUInt32LE(at + 42),
  };
  return { record, next: at + 46 + nameLength + extras };
}

function assertRange(archive: Buffer, start: number, length: number): void {
  if (start < 0 || start + length > archive.length) {
    fail("Truncated zip archive");
  }
}

/** Whether an entry name could escape an extraction root or confuse lookups. */
export function isUnsafeEntryName(name: string): boolean {
  return (
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[a-z]:/iu.test(name) ||
    name.split("/").some((segment) => segment === ".." || segment === ".")
  );
}

function indexEntries(
  archive: Buffer,
  records: CentralRecord[],
  maxEntryBytes: number,
): Map<string, ZipEntry> {
  const entries = new Map<string, ZipEntry>();
  for (const record of records) {
    if (record.name.endsWith("/")) {
      continue;
    }
    validateRecord(record, maxEntryBytes);
    if (entries.has(record.name)) {
      fail(`Duplicate zip entry: ${record.name}`);
    }
    entries.set(record.name, {
      name: record.name,
      size: record.size,
      read: () => extract(archive, record),
    });
  }
  return entries;
}

function validateRecord(record: CentralRecord, maxEntryBytes: number): void {
  if (isUnsafeEntryName(record.name)) {
    fail(`Unsafe zip entry name: ${record.name}`);
  }
  if (record.flags % 2 === 1) {
    fail(`Encrypted zip entries are not supported: ${record.name}`);
  }
  if (record.method !== STORE && record.method !== DEFLATE) {
    fail(`Unsupported compression method ${record.method}: ${record.name}`);
  }
  if (record.size > maxEntryBytes) {
    fail(`Zip entry exceeds ${maxEntryBytes} bytes: ${record.name}`);
  }
}

function extract(archive: Buffer, record: CentralRecord): Buffer {
  const at = record.localOffset;
  assertRange(archive, at, 30);
  if (archive.readUInt32LE(at) !== LOCAL_SIGNATURE) {
    fail(`Corrupt local header: ${record.name}`);
  }
  const raw = entryData(archive, record);
  const data = record.method === STORE ? raw : inflate(raw, record);
  if (data.length !== record.size || crc32(data) !== record.crc) {
    fail(`Zip entry failed integrity check: ${record.name}`);
  }
  return data;
}

/** Compressed bytes of an entry, located through its local header. */
function entryData(archive: Buffer, record: CentralRecord): Buffer {
  const at = record.localOffset;
  const start = at + 30 + archive.readUInt16LE(at + 26) + archive.readUInt16LE(at + 28);
  assertRange(archive, start, record.compressedSize);
  return archive.subarray(start, start + record.compressedSize);
}

function inflate(raw: Buffer, record: CentralRecord): Buffer {
  try {
    // Cap output at the declared size (+1 so overruns are detectable, not truncated).
    return inflateRawSync(raw, { maxOutputLength: record.size + 1 });
  } catch {
    return fail(`Zip entry failed to inflate: ${record.name}`);
  }
}
