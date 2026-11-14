import { Clock } from './clock';

/** Test clock: it only moves when a test moves it. */
export class FixedClock extends Clock {
  private current: Date;

  constructor(instant: Date | string) {
    super();
    this.current = new Date(instant);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
