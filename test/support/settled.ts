/** How long callsSettled waits for the expected calls, well inside Jest's 5 s test timeout. */
const SETTLE_DEADLINE_MS = 2_000;

/**
 * Waits until `spy` has been called at least `count` times and every call has settled, then
 * one more macrotask, so the callers have moved past their reads. Concurrency
 * tests use it to hold a fetch until every caller has reached a shared refresh.
 * Fails with the counts when the calls do not arrive, instead of a bare timeout.
 */
export async function callsSettled(
  spy: jest.SpyInstance<Promise<unknown>>,
  count: number,
): Promise<void> {
  const deadline = Date.now() + SETTLE_DEADLINE_MS;
  while (spy.mock.calls.length < count) {
    if (Date.now() > deadline) {
      throw new Error(
        `callsSettled: expected ${count} calls within ${SETTLE_DEADLINE_MS} ms, saw ${spy.mock.calls.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await Promise.all(spy.mock.results.map((result): unknown => result.value));
  await new Promise((resolve) => setImmediate(resolve));
}
