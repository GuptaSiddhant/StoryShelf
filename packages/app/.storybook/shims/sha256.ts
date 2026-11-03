// oxlint-disable eslint/no-bitwise, eslint/max-statements, eslint/id-length, eslint/max-lines-per-function, unicorn/no-array-for-each, unicorn/number-literal-case, unicorn/numeric-separators-style, unicorn/consistent-function-scoping, typescript/explicit-function-return-type -- SHA-256 is 32-bit word arithmetic by definition; this is a story-only stand-in for node:crypto, verified against it
/**
 * Synchronous SHA-256 (hex digest) for the Storybook bundle, where `node:crypto` does not exist.
 * Output equals Node's `createHash("sha256")`.
 */
const K = Uint32Array.from({ length: 64 }, (_, index) => {
  let candidate = 2;
  let found = 0;
  while (true) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
      if (candidate % divisor === 0) prime = false;
    }
    if (prime) {
      if (found === index) return Math.floor((candidate ** (1 / 3) % 1) * 2 ** 32);
      found += 1;
    }
    candidate += 1;
  }
});

export function sha256(bytes: Uint8Array): string {
  const length = bytes.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  const hash = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotate = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const a = w[index - 15] ?? 0;
      const b = w[index - 2] ?? 0;
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      w[index] = ((w[index - 16] ?? 0) + s0 + (w[index - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as unknown as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choose + (K[index] ?? 0) + (w[index] ?? 0)) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => {
      hash[index] = ((hash[index] ?? 0) + value) >>> 0;
    });
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}
