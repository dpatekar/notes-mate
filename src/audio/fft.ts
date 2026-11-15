/** In-place radix-2 FFT of a real signal. Reusable instance per size. */
export class FFT {
  readonly size: number;
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;
  private re: Float32Array;
  private im: Float32Array;

  constructor(size: number) {
    if (size & (size - 1)) throw new Error('FFT size must be a power of two');
    this.size = size;
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /** Writes magnitudes of bins 0..size/2-1 into `out`. */
  magnitudes(input: Float32Array, out: Float32Array): void {
    const n = this.size;
    const { re, im, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      re[rev[i]] = input[i];
      im[i] = 0;
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j;
          const b = a + half;
          const tr = re[b] * cos[k] + im[b] * sin[k];
          const ti = im[b] * cos[k] - re[b] * sin[k];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
  }
}
