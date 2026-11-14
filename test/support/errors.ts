type ErrorClass<E extends Error> = abstract new (...args: never[]) => E;

/** The error `run` throws, checked to be an instance of `type`. */
export function thrown<E extends Error>(run: () => unknown, type: ErrorClass<E>): E {
  try {
    run();
  } catch (error) {
    return expectInstance(error, type);
  }
  throw new Error(`expected ${type.name} to be thrown`);
}

/** The reason `promise` rejects with, checked to be an instance of `type`. */
export async function rejected<E extends Error>(
  promise: Promise<unknown>,
  type: ErrorClass<E>,
): Promise<E> {
  try {
    await promise;
  } catch (error) {
    return expectInstance(error, type);
  }
  throw new Error(`expected a rejection with ${type.name}`);
}

function expectInstance<E extends Error>(error: unknown, type: ErrorClass<E>): E {
  if (error instanceof type) {
    return error;
  }
  throw new Error(`expected ${type.name}, got ${String(error)}`, { cause: error });
}
