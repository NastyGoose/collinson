import { validateEnv } from '../../../src/config/config.logic';

const DATABASE_URL = 'postgresql://user:secret@localhost:5432/collinson';

describe('validateEnv', () => {
  it('accepts a PostgreSQL URL and defaults PORT, LOG_LEVEL and introspection', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      PORT: 3000,
      LOG_LEVEL: 'info',
      GRAPHQL_INTROSPECTION: true,
    });
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

  it.each(['debug', 'silent'])('accepts LOG_LEVEL=%s', (level) => {
    expect(validateEnv({ DATABASE_URL, LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
  });

  it.each(['verbose', 'INFO', '1'])(
    'rejects LOG_LEVEL=%s and lists the accepted levels',
    (level) => {
      expect(() => validateEnv({ DATABASE_URL, LOG_LEVEL: level })).toThrow(
        /LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent/,
      );
    },
  );

  it.each([
    ['development', undefined, true],
    ['test', undefined, true],
    [undefined, '', true],
    ['production', undefined, false],
    ['production', '', false],
    ['production', 'true', true],
    ['development', 'false', false],
  ])(
    'with NODE_ENV=%s and GRAPHQL_INTROSPECTION=%j, introspection is %s',
    (nodeEnv, introspection, expected) => {
      const env = validateEnv({
        DATABASE_URL,
        NODE_ENV: nodeEnv,
        GRAPHQL_INTROSPECTION: introspection,
      });

      expect(env.GRAPHQL_INTROSPECTION).toBe(expected);
    },
  );

  it.each(['1', 'yes', 'TRUE'])('rejects GRAPHQL_INTROSPECTION=%s', (value) => {
    expect(() => validateEnv({ DATABASE_URL, GRAPHQL_INTROSPECTION: value })).toThrow(
      /GRAPHQL_INTROSPECTION must be true or false/,
    );
  });
});
