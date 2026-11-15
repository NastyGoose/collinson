import { validateEnv } from '../../../src/config/env';

const DATABASE_URL = 'postgresql://user:secret@localhost:5432/collinson';

describe('validateEnv', () => {
  it('accepts a PostgreSQL URL and defaults PORT to 3000', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({ DATABASE_URL, PORT: 3000 });
  });

  it('parses PORT from its string form', () => {
    expect(validateEnv({ DATABASE_URL, PORT: '4100' }).PORT).toBe(4100);
  });

  it('names DATABASE_URL and .env.example when the URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL is not set.*\.env\.example/);
  });

  it('rejects a non-PostgreSQL URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /postgresql:\/\/ connection URL/,
    );
  });

  it.each(['0', '65536', '3.5', 'abc'])('rejects PORT=%s', (port) => {
    expect(() => validateEnv({ DATABASE_URL, PORT: port })).toThrow(/PORT must be an integer/);
  });
});
