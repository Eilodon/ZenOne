export interface TimedSample<T> { tMs: number; v: T; }

export class TimeWindowBuffer<T> {
    private buf: TimedSample<T>[] = [];
    constructor(private maxSpanSec: number) { }

    push(tMs: number, v: T) {
        this.buf.push({ tMs, v });
        this.compact(tMs);
    }

    private compact(nowMs: number) {
        const cutoff = nowMs - this.maxSpanSec * 1000;
        while (this.buf.length && this.buf[0].tMs < cutoff) this.buf.shift();
    }

    spanSec(): number {
        if (this.buf.length < 2) return 0;
        return (this.buf[this.buf.length - 1].tMs - this.buf[0].tMs) / 1000;
    }

    samples(): TimedSample<T>[] { return this.buf; }
    size(): number { return this.buf.length; }
    clear() { this.buf = []; }
}
