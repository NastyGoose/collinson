import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { GraphQLFormattedError } from 'graphql';

/**
 * Fixed client messages per body-parser error type. Parser diagnostics can quote
 * the submitted body (V8 includes a snippet of invalid JSON), and the charset and
 * encoding errors quote a request header, so none of their text is sent back.
 */
const BODY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  'entity.parse.failed': 'The request body is not valid JSON.',
  'entity.too.large': 'The request body is too large.',
  'charset.unsupported': 'The request body charset is not supported.',
  'encoding.unsupported': 'The request body content encoding is not supported.',
};
const DEFAULT_BODY_ERROR_MESSAGE = 'The request body could not be read.';

/**
 * Global filter for requests whose body never reached GraphQL. Nest's Express
 * adapter turns a body-parser failure, such as malformed JSON, into an
 * HttpException that carries the parser's message. This filter answers it with
 * the same 4xx status and a GraphQL-shaped body with a fixed message and the
 * BAD_REQUEST code Apollo uses for its own malformed-request errors (ARC-59).
 *
 * Every other exception keeps Nest's default handling: over HTTP through
 * BaseExceptionFilter, and inside a resolver it is returned unchanged for the
 * GraphQL error pipeline (`formatGraphQLError`).
 */
@Catch(HttpException)
export class RequestBodyErrorFilter extends BaseExceptionFilter<HttpException> {
  override catch(exception: HttpException, host: ArgumentsHost): HttpException | undefined {
    if (host.getType() !== 'http') {
      return exception;
    }
    const bodyErrorType = bodyParserErrorType(exception.cause);
    const adapter = this.httpAdapterHost?.httpAdapter;
    if (bodyErrorType === null || adapter === undefined) {
      super.catch(exception, host);
      return undefined;
    }
    const error: GraphQLFormattedError = {
      message: BODY_ERROR_MESSAGES[bodyErrorType] ?? DEFAULT_BODY_ERROR_MESSAGE,
      extensions: { code: 'BAD_REQUEST' },
    };
    adapter.reply(host.switchToHttp().getResponse(), { errors: [error] }, exception.getStatus());
    return undefined;
  }
}

/** The `type` body-parser sets on its errors (http-errors with a 4xx status), or null. */
function bodyParserErrorType(cause: unknown): string | null {
  if (!(cause instanceof Error) || !('type' in cause) || !('status' in cause)) {
    return null;
  }
  const { type, status } = cause;
  return typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500
    ? type
    : null;
}
