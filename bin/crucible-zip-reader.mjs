// Reads the zip files that scripts/build-pack-index.mjs writes: stored or deflated entries, no encryption, no zip64.
// Every entry name, size and checksum is checked before a byte is returned, so a broken or hostile zip stops here.
import { crc32, inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const ENCRYPTED_FLAG = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const SYMBOLIC_LINK_TYPE = 0o120000;
const FILE_TYPE_MASK = 0o170000;
const END_RECORD_BYTES = 22;
const LONGEST_COMMENT = 0xffff;

function zipError(problem, fix) {
  return new Error(`The pack zip ${problem}. ${fix}`);
}

function findEndRecord(bytes) {
  const earliest = Math.max(0, bytes.length - END_RECORD_BYTES - LONGEST_COMMENT);
  for (let offset = bytes.length - END_RECORD_BYTES; offset >= earliest; offset -= 1) {
    if (bytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw zipError('has no end record, so it is cut off or not a zip', 'Download it again.');
}

/** A safe relative path: forward slashes, no empty, dot or dot-dot parts, no drive letter, no control characters. */
export function checkEntryName(name) {
  const unsafe = name.length === 0
    || name.startsWith('/')
    || name.includes('\\')
    || /^[a-zA-Z]:/.test(name)
    || /[\u0000-\u001f]/.test(name)
    || name.split('/').some(part => part === '' || part === '.' || part === '..');
  if (unsafe) throw zipError(`holds an unsafe entry name "${name}"`, 'Install only packs from the pinned release.');
  return name;
}

function readCentralEntries(bytes, limits) {
  const end = findEndRecord(bytes);
  const entryCount = bytes.readUInt16LE(end + 10);
  const directoryBytes = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) throw zipError('uses zip64', 'Packs are plain zips; download the pinned release again.');
  if (entryCount > limits.maximumFiles) throw zipError(`holds ${entryCount} files, above the limit of ${limits.maximumFiles}`, 'A pack holds at most that many files.');
  if (directoryOffset + directoryBytes > end) throw zipError('has a central directory past its end', 'Download it again.');
  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== CENTRAL_HEADER) throw zipError('has a broken central directory', 'Download it again.');
    const flags = bytes.readUInt16LE(offset + 8);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({
      name,
      flags,
      method: bytes.readUInt16LE(offset + 10),
      checksum: bytes.readUInt32LE(offset + 16),
      compressedSize: bytes.readUInt32LE(offset + 20),
      size: bytes.readUInt32LE(offset + 24),
      fileType: (bytes.readUInt32LE(offset + 38) >>> 16) & FILE_TYPE_MASK,
      localOffset: bytes.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function checkEntry(entry, seenNames) {
  if (entry.flags & ENCRYPTED_FLAG) throw zipError(`entry "${entry.name}" is encrypted`, 'Packs are never encrypted.');
  if (entry.flags & DATA_DESCRIPTOR_FLAG) throw zipError(`entry "${entry.name}" uses a data descriptor`, 'Download the pinned release again.');
  if (entry.method !== STORED && entry.method !== DEFLATED) throw zipError(`entry "${entry.name}" uses compression method ${entry.method}`, 'Packs use stored or deflate only.');
  if (entry.fileType === SYMBOLIC_LINK_TYPE) throw zipError(`entry "${entry.name}" is a symbolic link`, 'Packs hold plain files only.');
  checkEntryName(entry.name);
  const folded = entry.name.toLowerCase();
  if (seenNames.has(folded)) throw zipError(`holds "${entry.name}" twice (names compare without case)`, 'Install only packs from the pinned release.');
  seenNames.add(folded);
}

function entryData(bytes, entry) {
  const offset = entry.localOffset;
  if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== LOCAL_HEADER) throw zipError(`entry "${entry.name}" has no local header`, 'Download it again.');
  const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
  if (start + entry.compressedSize > bytes.length) throw zipError(`entry "${entry.name}" is cut off`, 'Download it again.');
  const stored = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === STORED) return stored;
  try {
    return inflateRawSync(stored, { maxOutputLength: entry.size + 1 });
  } catch (error) {
    throw zipError(`entry "${entry.name}" does not inflate (${error.message})`, 'Download it again.');
  }
}

/**
 * Returns [{ name, data }] for every file in the zip, after checking names, sizes and CRC-32.
 * limits: { maximumFiles, maximumBytes, maximumFileBytes }.
 */
export function readZip(bytes, limits) {
  const entries = readCentralEntries(bytes, limits);
  const seenNames = new Set();
  let totalBytes = 0;
  const files = [];
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    checkEntry(entry, seenNames);
    if (entry.size > limits.maximumFileBytes) throw zipError(`entry "${entry.name}" is ${entry.size} bytes, above the limit of ${limits.maximumFileBytes}`, 'A pack file holds at most that many bytes.');
    totalBytes += entry.size;
    if (totalBytes > limits.maximumBytes) throw zipError(`unpacks to more than ${limits.maximumBytes} bytes`, 'A pack holds at most that many bytes.');
    const data = entryData(bytes, entry);
    if (data.length !== entry.size || crc32(data) !== entry.checksum) throw zipError(`entry "${entry.name}" fails its size or CRC-32 check`, 'Download it again.');
    files.push({ name: entry.name, data });
  }
  return files;
}
