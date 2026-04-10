export type TextSegmenterOptions = {
  minChars?: number;
  maxChars?: number;
};

// Splits incrementally appended text into speakable segments.
// Intended for Japanese explanations: prefer line breaks and sentence terminators.
export class TextSegmenter {
  private buffer = "";
  private readonly minChars: number;
  private readonly maxChars: number;

  constructor(opt: TextSegmenterOptions = {}) {
    this.minChars = opt.minChars ?? 20;
    this.maxChars = opt.maxChars ?? 200;
  }

  push(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;
    return this.drainSegments(false);
  }

  flush(): string[] {
    return this.drainSegments(true);
  }

  reset(): void {
    this.buffer = "";
  }

  private drainSegments(force: boolean): string[] {
    const segments: string[] = [];

    // Emit segments while we have a clear boundary or buffer too large.
    for (;;) {
      const trimmed = this.buffer.trim();
      if (!force && trimmed.length < this.minChars && this.buffer.length <= this.maxChars) break;
      if (trimmed.length === 0) {
        this.buffer = "";
        break;
      }

      const cut = this.findCutIndex(this.buffer, force);
      if (cut <= 0) {
        if (force) {
          const last = this.buffer.trim();
          if (last) segments.push(last);
          this.buffer = "";
        }
        break;
      }

      const seg = this.buffer.slice(0, cut).trim();
      const rest = this.buffer.slice(cut);

      // Avoid emitting too-short segments unless forced or we must cut due to max length.
      if (!force && seg.length < this.minChars && this.buffer.length <= this.maxChars) break;

      if (seg) segments.push(seg);
      this.buffer = rest;

      // If we're forcing, continue until fully drained.
      if (!force) {
        const remainingTrimmed = this.buffer.trim();
        if (remainingTrimmed.length < this.minChars && this.buffer.length <= this.maxChars) break;
      }
    }

    return segments;
  }

  private findCutIndex(s: string, force: boolean): number {
    const hardMax = Math.min(this.maxChars, s.length);

    // Prefer newline boundary.
    const nl = s.lastIndexOf("\n", hardMax - 1);
    if (nl >= 0) {
      const candidate = s.slice(0, nl).trim();
      if (candidate.length >= this.minChars || force) return nl + 1;
    }

    // Prefer sentence terminators (Japanese/ASCII).
    const terminators = ["。", "．", ".", "！", "!", "？", "?"];
    let best = -1;
    for (const t of terminators) {
      const idx = s.lastIndexOf(t, hardMax - 1);
      if (idx > best) best = idx;
    }
    if (best >= 0) {
      const end = best + 1;
      const candidate = s.slice(0, end).trim();
      if (candidate.length >= this.minChars || force) return end;
    }

    // If too long, force a cut.
    if (s.length > this.maxChars) {
      return hardMax;
    }

    // No good boundary yet.
    return force ? s.length : -1;
  }
}
