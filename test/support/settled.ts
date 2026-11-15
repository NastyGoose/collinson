/**
 * Waits until `spy` has been called `count` times and every call has settled, then
 * one more macrotask, so the callers have moved past their reads. Concurrency
 * tests use it to hold a fetch until every caller has reached a shared refresh.
 */
export async function callsSettled(
  spy: jest.SpyInstance<Promise<unknown>>,
  count: number,
): Promise<void> {
  while (spy.mock.calls.length < count) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await Promise.all(spy.mock.results.map((result): unknown => result.value));
  await new Promise((resolve) => setImmediate(resolve));
}
