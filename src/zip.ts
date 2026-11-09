// A plain zip, for handing over a design's files together. STL doesn't shrink much for the time it
// takes, so files are stored as they are, which needs nothing but a checksum.
export interface ZipFile {
  name: string;
  bytes: Uint8Array;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function writeZip(files: ZipFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries = files.map((file) => ({ ...file, encoded: encoder.encode(file.name), crc: crc32(file.bytes) }));
  const localSize = entries.reduce((sum, e) => sum + 30 + e.encoded.length + e.bytes.length, 0);
  const centralSize = entries.reduce((sum, e) => sum + 46 + e.encoded.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  // A fixed date, so that the same design gives the same bytes.
  const DOS_DATE = 0x5821;
  for (const e of entries) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 0x0800, true); // names are UTF-8
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, e.crc, true);
    view.setUint32(at + 18, e.bytes.length, true);
    view.setUint32(at + 22, e.bytes.length, true);
    view.setUint16(at + 26, e.encoded.length, true);
    out.set(e.encoded, at + 30);
    out.set(e.bytes, at + 30 + e.encoded.length);
    at += 30 + e.encoded.length + e.bytes.length;
  }
  const centralStart = at;
  entries.forEach((e, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.bytes.length, true);
    view.setUint32(at + 24, e.bytes.length, true);
    view.setUint16(at + 28, e.encoded.length, true);
    view.setUint32(at + 42, offsets[i]!, true);
    out.set(e.encoded, at + 46);
    at += 46 + e.encoded.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}
