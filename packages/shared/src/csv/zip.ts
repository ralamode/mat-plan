/**
 * A minimal **STORED** (uncompressed) zip writer (V1-13b).
 *
 * ## Why hand-rolled rather than a dependency
 *
 * [SECURITY.md](../../../../.github/SECURITY.md) says minimise dependencies, and this is the MVP's
 * last feature. The alternative (`fflate`) is small and good, but a zip of a few KB of text gains
 * nothing from compression, and STORED mode needs no compressor at all — only a CRC-32 and two
 * fixed-layout records. That is the whole format below.
 *
 * ## Why a zip at all
 *
 * The Claude workflow consumes a DIRECTORY TREE — `data/<type>/<athlete>/<YYYY-MM>.csv`. A zip is the
 * only single artifact a browser can hand over that preserves paths; the alternative is one download
 * per file, which is kids × months × 4 clicks.
 *
 * ## Deliberately not supported
 *
 * No compression, no ZIP64, no encryption, no directory entries. Files are UTF-8 text a few KB each,
 * so the 4GB and 65,535-entry limits are unreachable, and every real unzip tool infers directories
 * from the entry paths.
 */

/** CRC-32 (IEEE 802.3), the one zip requires. Table built once, lazily. */
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { path: string; content: string };

/**
 * Build a zip from text entries.
 *
 * ⚠️ **Deterministic by construction** — no timestamps are written (the DOS date/time fields are
 * zeroed). Re-exporting the same data twice produces byte-identical output, which is the property
 * the workflow depends on and the one a `mtime` would quietly break.
 */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);

    // Local file header: signature, version 2.0, no flags, method 0 (STORED), zeroed date/time,
    // crc, sizes (equal, since STORED), name length, no extra field.
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed == uncompressed
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);

    chunks.push(new Uint8Array(local.buffer), name, data);

    // Central directory record — the index a reader actually uses.
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true); // where the local header lives
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // entries total
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // central directory offset
  central.push(new Uint8Array(end.buffer));

  const all = [...chunks, ...central];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
