/**
 * Source of the current instant. Services take it by injection rather than calling
 * `new Date()`, so tests can freeze request time, cache expiry and freshness.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
