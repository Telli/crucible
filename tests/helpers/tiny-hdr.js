// A 4 by 2 uncompressed Radiance file, small enough to decode in a test that only needs a registered HDRI.
export function tinyHdrBytes() {
  const header = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n');
  const pixels = Buffer.alloc(4 * 2 * 4);
  for (let pixel = 0; pixel < 8; pixel++) {
    pixels.set([128, 128, 128, 129], pixel * 4);
  }
  return Buffer.concat([header, pixels]);
}
