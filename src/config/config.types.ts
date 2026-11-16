/** The pino levels LOG_LEVEL accepts; `silent` turns logging off. */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface Env {
  DATABASE_URL: string;
  PORT: number;
  LOG_LEVEL: LogLevel;
  /** Whether GraphQL introspection queries are allowed. */
  GRAPHQL_INTROSPECTION: boolean;
}
