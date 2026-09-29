/**
 * Time for the demo backend.
 *
 * Every simulated delay goes through a `Scheduler`, so the same engine code runs
 *  - live, on real timers scaled by `timeScale` (1 = realistic latencies; tests use ~0.01), and
 *  - instantly, on a virtual clock, to generate the seeded history (past tasks with real timelines).
 */

export interface DemoConfig {
  /** Multiplier for every simulated latency (steps, planning, retries, keep-alives). */
  timeScale: number;
}

const config: DemoConfig = { timeScale: 1 };

export function configureDemoClock(partial: Partial<DemoConfig>): void {
  if (partial.timeScale !== undefined) {
    if (!(partial.timeScale > 0)) throw new Error("timeScale must be > 0");
    config.timeScale = partial.timeScale;
  }
}

export function timeScale(): number {
  return config.timeScale;
}

export interface Scheduler {
  /** Epoch milliseconds. */
  now(): number;
  /** Run `fn` after `ms` of simulated time. Returns a cancel function. */
  after(ms: number, fn: () => void): () => void;
}

/** Real timers (scaled). Used for everything the visitor does. */
export const realScheduler: Scheduler = {
  now: () => Date.now(),
  after(ms, fn) {
    const handle = setTimeout(fn, Math.max(0, ms * config.timeScale));
    return () => clearTimeout(handle);
  },
};

interface Pending {
  at: number;
  order: number;
  fn: () => void;
  cancelled: boolean;
}

/** Deterministic virtual clock: `runUntilIdle()` executes queued work synchronously in time order. */
export class VirtualScheduler implements Scheduler {
  private queue: Pending[] = [];
  private order = 0;

  constructor(private t: number) {}

  now(): number {
    return this.t;
  }

  setTime(t: number): void {
    this.t = t;
  }

  advance(ms: number): void {
    this.t += ms;
  }

  after(ms: number, fn: () => void): () => void {
    const item: Pending = { at: this.t + Math.max(0, ms), order: this.order++, fn, cancelled: false };
    this.queue.push(item);
    return () => {
      item.cancelled = true;
    };
  }

  runUntilIdle(limit = 20_000): void {
    for (let i = 0; i < limit; i++) {
      this.queue = this.queue.filter((q) => !q.cancelled);
      if (this.queue.length === 0) return;
      this.queue.sort((a, b) => a.at - b.at || a.order - b.order);
      const next = this.queue.shift()!;
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    throw new Error("VirtualScheduler: work did not settle");
  }
}

/** Uniformly distributed latency in [min, max] ms. */
export function latency(minMs: number, maxMs: number): number {
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}
