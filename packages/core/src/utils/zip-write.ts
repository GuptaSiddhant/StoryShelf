/**
 * Minimal streaming zip writer (STORE method, no zip64).
 *
 * Baseline exports are PNGs — already deflated — so entries are stored
 * uncompressed. Entries are produced one at a time, so memory stays bounded
 * by the largest single entry rather than the whole archive.
 */
import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";

/** One file to add to an archive; `data` is read lazily when the entry is written. */
export interface ZipSource {
  name: string;
  data: () => Promise<Buffer>;
}

/**
 * Stream a zip archive for `sources`, yielding header/data chunks in order.
 *
 * @throws When the archive would need zip64 (more than 65535 entries or 4 GiB).
 */
export async function* zipStream(
  sources: Iterable<ZipSource> | AsyncIterable<ZipSource>,
): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;
  for await (const source of sources) {
    const data = await source.data();
    const record = entryRecord(source.name, data);
    central.push(centralHeader(record, offset));
    yield* [localHeader(record), data];
    offset = checkedSize(offset + 30 + record.name.length + data.length);
  }
  yield* trailer(central, offset);
}

/** Header fields shared by the local and central records of an entry. */
interface EntryRecord {
  name: Buffer;
  crc: number;
  size: number;
}

const MAX_U32 = 0xff_ff_ff_ff;
const MAX_ENTRIES = 0xff_ff;
/** General-purpose flag bit 11: file names are UTF-8. */
const UTF8_FLAG = 0x08_00;
/** 1980-01-01 in DOS date format — fixed so archives are byte-reproducible. */
const DOS_DATE = 0x00_21;
const VERSION = 20;

function entryRecord(name: string, data: Buffer): EntryRecord {
  return { name: Buffer.from(name, "utf8"), crc: crc32(data), size: checkedSize(data.length) };
}

function checkedSize(size: number): number {
  if (size > MAX_U32) {
    throw new Error("Archive exceeds 4 GiB (zip64 is not supported)");
  }
  return size;
}

/** `[offset, width, value]` triples for a fixed-size header. */
type Fields = readonly (readonly [offset: number, width: 2 | 4, value: number])[];

function header(size: number, fields: Fields, name?: Buffer): Buffer {
  const out = Buffer.alloc(size);
  for (const [offset, width, value] of fields) {
    if (width === 2) {
      out.writeUInt16LE(value, offset);
    } else {
      out.writeUInt32LE(value, offset);
    }
  }
  return name ? Buffer.concat([out, name]) : out;
}

function localHeader(record: EntryRecord): Buffer {
  return header(
    30,
    [
      [0, 4, 0x04_03_4b_50],
      [4, 2, VERSION],
      [6, 2, UTF8_FLAG],
      [12, 2, DOS_DATE],
      [14, 4, record.crc],
      [18, 4, record.size],
      [22, 4, record.size],
      [26, 2, record.name.length],
    ],
    record.name,
  );
}

function centralHeader(record: EntryRecord, offset: number): Buffer {
  return header(
    46,
    [
      [0, 4, 0x02_01_4b_50],
      [4, 2, VERSION],
      [6, 2, VERSION],
      [8, 2, UTF8_FLAG],
      [14, 2, DOS_DATE],
      [16, 4, record.crc],
      [20, 4, record.size],
      [24, 4, record.size],
      [28, 2, record.name.length],
      [42, 4, offset],
    ],
    record.name,
  );
}

function* trailer(central: Buffer[], offset: number): Generator<Buffer> {
  if (central.length > MAX_ENTRIES) {
    throw new Error("Archive exceeds 65535 entries (zip64 is not supported)");
  }
  const directory = Buffer.concat(central);
  yield directory;
  yield header(22, [
    [0, 4, 0x06_05_4b_50],
    [8, 2, central.length],
    [10, 2, central.length],
    [12, 4, directory.length],
    [16, 4, checkedSize(offset)],
  ]);
}
