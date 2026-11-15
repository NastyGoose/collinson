import { Prisma } from '../generated/prisma/client';

/**
 * Prisma error codes for an unreachable, overloaded or conflicting database:
 * P1xxx connection and server errors, P2024 pool timeout, P2028 transaction API
 * error, P2034 write conflict or deadlock. https://www.prisma.io/docs/orm/reference/error-reference
 */
const STORAGE_FAILURE_CODES = new Set(['P2024', 'P2028', 'P2034']);

/**
 * True when the error means PostgreSQL could not serve the operation, as opposed
 * to a constraint violation from a schema mismatch or a programming error, which
 * repositories rethrow unchanged.
 */
export function isStorageFailure(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code.startsWith('P1') || STORAGE_FAILURE_CODES.has(error.code);
  }
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}
