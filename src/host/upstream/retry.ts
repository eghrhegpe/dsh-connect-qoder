/**
 * retry — 自 src/host/upstream.ts 原文搬迁，未改逻辑
 *
 * 拆分依据 docs/issues/22-upstream-split.md；本文件代码逐字来自拆分前的
 * upstream.ts（见 git 历史里拆分前的那一版），只做 import/export 整理与
 * 文件头标注。协议事实的原文注释在 crypto.ts 头部。
 */

/**
 * How long one turn may spend waiting out Qoder's queue, in total.
 *
 * The gateway answers a queued request with `10605` plus a `retryAfterSeconds`
 * hint, and the official client simply waits and tries again. Handing that wait
 * to DSH instead does not work: DSH's retry policy is fixed (5 attempts, 500 ms
 * doubling to a 10 s ceiling, ~40 s of total budget) and ignores the hint, so a
 * queue that clears in 60 s exhausts the budget and the turn fails — after
 * which the user has to send the message again, which restarts the turn from
 * scratch rather than resuming the wait.
 *
 * This module therefore owns the wait. The budget stays well under the 300 s
 * idle ceiling the adapter declares, so a queued turn is never killed by the
 * stream watchdog while it waits.
 */
export const QUEUE_WAIT_BUDGET_MS = 120000

/** Longest single sleep, so one absurd hint cannot stall a turn indefinitely. */
export const QUEUE_WAIT_MAX_SLEEP_MS = 30000

/** Sleep before the first retry when the gateway gives no hint at all. */
export const QUEUE_WAIT_MIN_SLEEP_MS = 1000

/**
 * How long ONE attempt may wait for response headers before it is treated as
 * a failed try. It bounds the handshake only, never the body: an answer that
 * keeps streaming past it is healthy and must not be cut (see `openAttempt`).
 *
 * Without a per-attempt deadline the queue budget below is fiction: it counts
 * only the sleeps between attempts, so a gateway that accepts the connection
 * and then never returns response headers hangs `fetch` forever while
 * `waitedMs` stays at zero. The loop, the budget check, and the adapter's idle
 * watchdog are all bypassed, and the turn never produces a byte of output.
 *
 * This is sized for the slow-but-progressing case the queue legitimately
 * produces, not for a healthy response: the first token of a queued turn can
 * take a while to appear, and killing that would throw away real work. It only
 * has to be short enough that a *stuck* attempt is charged to the budget and
 * retried instead of pinning the turn forever.
 */
export const ATTEMPT_TIMEOUT_MS = 60000

/** Abortable sleep; resolves early (without throwing) when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(finish, Math.max(0, ms))
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Timestamps come in seconds, milliseconds, and RFC 3339 strings across the
 * upstream's routes. The single coercion used everywhere is `toEpochMs` in
 * `time.js`; this module re-exports nothing of its own.
 */

/**
 * How long to wait before retrying a queue rejection, or `undefined` when it is
 * not a queue rejection or the wait budget is spent.
 *
 * The gateway's own `retryAfterSeconds` is the primary signal and is honoured
 * as given. It is not always accurate, though: a queue that keeps answering
 * "retry in 2s" for a minute would otherwise be polled every two seconds for the
 * whole budget, which is both rude and pointless. So once a few consecutive
 * rejections have shown the hint is not converging, the pause escalates
 * geometrically up to {@link QUEUE_WAIT_MAX_SLEEP_MS}.
 *
 * @param error - the rejection to judge.
 * @param waitedMs - time already spent waiting in this turn.
 * @param attempt - 1-based index of the attempt that was just rejected.
 * @returns the sleep in milliseconds, or `undefined` when the turn should stop
 *   retrying. Exported so the budget invariant ("never more than remains") is
 *   asserted against the real function rather than a copy of the arithmetic —
 *   the old clamp broke it in a way no reader of `streamChat` could see.
 */
export function queueWaitFor(error: unknown, waitedMs: number, attempt: number): number | undefined {
  if ((error as { retryable?: unknown } | null | undefined)?.retryable !== true) return undefined
  const remaining = QUEUE_WAIT_BUDGET_MS - waitedMs
  if (remaining <= 0) return undefined

  const hinted =
    Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds) > 0
      ? Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds) * 1000
      : QUEUE_WAIT_MIN_SLEEP_MS

  // Leave the first few attempts on the gateway's own advice; only start
  // backing off further once it is clear the hint is not clearing the queue.
  const GRACE_ATTEMPTS = 3
  const escalated =
    attempt > GRACE_ATTEMPTS
      ? QUEUE_WAIT_MIN_SLEEP_MS * 2 ** Math.min(attempt - GRACE_ATTEMPTS, 8)
      : 0

  const target = Math.max(hinted, escalated) * (0.75 + Math.random() * 0.5)
  // Clamp the target into [MIN, MAX] FIRST, then cap it at `remaining`.
  // The old shape — `Math.max(MIN, Math.min(target, MAX, remaining))` — put the
  // floor OUTSIDE the cap, so once the budget dropped below MIN_SLEEP the
  // function returned MIN_SLEEP regardless: a promise of "never wait past the
  // budget" that the code could not keep (measured: with 1 ms left it slept a
  // full 1000 ms). The floor belongs to the retry policy, not to the budget;
  // a sub-second last sleep is cheap and buys one more real attempt.
  const clamped = Math.max(QUEUE_WAIT_MIN_SLEEP_MS, Math.min(target, QUEUE_WAIT_MAX_SLEEP_MS))
  return Math.min(clamped, remaining)
}
