// Sizing of a render job screenshot (#3120). On macOS the headless window can be shorter than the requested
// viewport, and a screenshot without a clip then returns only the rows the window shows. The clip names the
// frame explicitly, and the check refuses to return a PNG whose size is not the one the job asked for.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function captureClip({ region, width, height }) {
  const frame = region ?? { x: 0, y: 0, width, height };
  return { x: frame.x, y: frame.y, width: frame.width, height: frame.height, scale: 1 };
}

export function readPngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('The captured frame is not a PNG, so its size cannot be checked.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function assertCapturedPngSize({ bytes, width, height }) {
  const captured = readPngSize(bytes);
  if (captured.width === width && captured.height === height) return;
  throw new Error(`The browser returned a ${captured.width}x${captured.height} frame for a ${width}x${height} render, so the job failed instead of keeping a cropped image. `
    + 'The page window was probably smaller than the requested size; request a smaller size or run the server with --backend cpu.');
}
