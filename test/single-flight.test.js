/**
 * Tests for the single-flight coalescer.
 *
 * Run: node --test test/single-flight.test.js
 *
 * The invariant this module exists for: while one run of the task is active,
 * every later call must JOIN it — not start a second one, and not wait for a
 * stale memoized answer after it has settled. Both halves break real things:
 * without joining, two catalog fetches race to `catalog.replace` and whichever
 * lands LAST wins (the data is not ordered by request); without freeing the
 * slot, the next legitimate refresh inherits a completed promise and the
 * catalog freezes at whatever the first fetch returned.
 *
 * The runs are driven by hand-settled deferreds rather than timers, so the
 * interleaving under test is exact rather than "probably within the sleep".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSingleFlight } from '../src/host/single-flight.ts'

/** A task whose completion the test controls. */
function deferredTask() {
  const runs = []
  const run = (...args) =>
    new Promise((resolve, reject) => {
      runs.push({ args, resolve, reject })
    })
  return { runs, task: createSingleFlight(run) }
}

test('concurrent calls share one run and all receive its result', async () => {
  const { runs, task } = deferredTask()
  const first = task('a')
  const second = task('b') // arrives while the first run is still live
  const third = task('c')

  assert.equal(runs.length, 1, 'joining callers must not start a second run')
  assert.deepEqual(runs[0].args, ['a'], 'the run carries the STARTING caller arguments')

  runs[0].resolve('result-1')
  // Same promise, not a similar value: the route handler and the timer await
  // one fetch, so upstream sees one request per completed refresh.
  assert.equal(await first, 'result-1')
  assert.equal(await second, 'result-1')
  assert.equal(await third, 'result-1')
})

test('a settled flight does not memoize — the next call starts a fresh run', async () => {
  const { runs, task } = deferredTask()
  const p1 = task(1)
  runs[0].resolve('one')
  assert.equal(await p1, 'one')

  const p2 = task(2)
  assert.equal(runs.length, 2, 'the slot must be free once the run settles')
  assert.deepEqual(runs[1].args, [2], 'the fresh run must see the fresh arguments, not the first call')
  runs[1].resolve('two')
  assert.equal(await p2, 'two')
})

test('a rejected run rejects every joiner and never blocks future runs', async () => {
  const { runs, task } = deferredTask()
  const failure = new Error('upstream 503')
  const p1 = task()
  const p2 = task()
  const p3 = task()
  assert.equal(runs.length, 1)
  runs[0].reject(failure)

  // Every joined caller must observe the same failure — a refresh that dies
  // quietly for the joiners is exactly the silent-swallow class again.
  for (const p of [p1, p2, p3]) {
    await assert.rejects(p, (error) => error === failure)
  }

  const p4 = task()
  assert.equal(runs.length, 2, 'a failed run must free the slot for the next attempt')
  runs[1].resolve('recovered')
  assert.equal(await p4, 'recovered')
})

test('a task that throws synchronously rejects instead of escaping the call', async () => {
  // A synchronous throw inside `task` happens after the slot is handed out in
  // this code's shape; if it escaped the promise, the caller would see an
  // exception while the slot stayed occupied forever — every later refresh
  // would then hang on a dead flight.
  const task = createSingleFlight(() => {
    throw new Error('sync boom')
  })
  await assert.rejects(task(), /sync boom/)
  // The slot is free again: a second call must run (and fail) on its own.
  let calls = 0
  const counting = createSingleFlight(() => {
    calls += 1
    throw new Error('again')
  })
  await assert.rejects(counting(), /again/)
  await assert.rejects(counting(), /again/)
  assert.equal(calls, 2, 'two sequential calls, two runs — no stuck flight')
})

test('coalescing does not swallow the second caller into a stale first run when timing is sequential', async () => {
  // The failure mode a naive "cache the promise forever" implementation has:
  // refresh #1 resolves at t=0, a real refresh at t=10 must fetch again.
  let n = 0
  const task = createSingleFlight(async () => {
    n += 1
    return n
  })
  assert.equal(await task(), 1)
  assert.equal(await task(), 2)
  assert.equal(await task(), 3)
})

test('reset lets the next call start a fresh run while the old one is still live', async () => {
  // The invalidation shape `RegionRuntime.invalidateUsage` needs: a reading is
  // in flight, an event (a claim) makes it worthless, and the caller that KNOWS
  // that must be able to ask for a new one instead of being joined onto the
  // worthless run.
  const { runs, task } = deferredTask()
  const doomed = task('before-claim')
  assert.equal(runs.length, 1)

  task.reset()
  const fresh = task('after-claim')

  assert.equal(runs.length, 2, 'reset must release the slot so a fresh run can start')
  assert.deepEqual(runs[1].args, ['after-claim'], 'the fresh run must see the fresh arguments')

  runs[0].resolve('stale-balance')
  runs[1].resolve('claimed-balance')

  // The abandoned run still answers the caller that was already waiting on it —
  // `reset` releases the SLOT, it does not cancel the work or strand an awaiter.
  assert.equal(await doomed, 'stale-balance')
  assert.equal(await fresh, 'claimed-balance')
})

test('a run abandoned by reset does not evict the run that replaced it', async () => {
  // The subtle half of `reset`. The abandoned run settles LATER, and its cleanup
  // runs then; clearing the slot unconditionally at that moment would evict the
  // newer run and reopen the coalescing window — the next caller would start a
  // third run while the second is still live.
  const { runs, task } = deferredTask()
  const abandoned = task('old')
  task.reset()
  const replacement = task('new')
  assert.equal(runs.length, 2)

  // The abandoned one settles FIRST, which is the dangerous ordering: if its
  // cleanup freed the slot, the call below would start run #3.
  runs[0].resolve('old-value')
  assert.equal(await abandoned, 'old-value')

  const joined = task('joiner')
  assert.equal(runs.length, 2, 'the replacement must still hold the slot')
  assert.deepEqual(runs[1].args, ['new'], 'the joiner must join the replacement run')

  runs[1].resolve('new-value')
  assert.equal(await replacement, 'new-value')
  assert.equal(await joined, 'new-value')
})

test('reset with nothing in flight is a no-op', async () => {
  const { runs, task } = deferredTask()
  task.reset()
  const p = task('only')
  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0].args, ['only'])
  runs[0].resolve('done')
  assert.equal(await p, 'done')
})
