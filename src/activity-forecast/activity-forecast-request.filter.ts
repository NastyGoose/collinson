import { type ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
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
 * Global filter for HTTP requests that never reach a resolver (ARC-59).
 *
 * - A body-parser failure, such as malformed JSON, reaches it as the HttpException
 *   Nest's Express adapter builds from the parser's message. It is answered with
 *   the same 4xx status and a GraphQL-shaped body with a fixed message and the
 *   BAD_REQUEST code Apollo uses for its own malformed-request errors.
 * - Nest's route-not-found 404 says `Cannot <METHOD> <path>`, which repeats the
 *   requested path. It keeps Nest's shape and status with a fixed message. It is
 *   recognized by rebuilding that exact message from the request, so a 404 thrown
 *   on purpose by a future controller keeps its own message.
 *
 * Every other exception keeps Nest's default handling: over HTTP through
 * BaseExceptionFilter. Inside a resolver the filter returns nothing, which Nest
 * reads as "not handled", so its external handler still logs and rethrows the
 * exception for the GraphQL error pipeline (`formatGraphQLError`).
 */
@Catch(HttpException)
export class RequestErrorFilter extends BaseExceptionFilter<HttpException> {
  override catch(exception: HttpException, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }
    const adapter = this.httpAdapterHost?.httpAdapter;
    if (adapter === undefined) {
      super.catch(exception, host);
      return;
    }
    const http = host.switchToHttp();
    const status = exception.getStatus();

    const bodyErrorType = bodyParserErrorType(exception.cause);
    if (bodyErrorType !== null) {
      const error: GraphQLFormattedError = {
        message: BODY_ERROR_MESSAGES[bodyErrorType] ?? DEFAULT_BODY_ERROR_MESSAGE,
        extensions: { code: 'BAD_REQUEST' },
      };
      adapter.reply(http.getResponse(), { errors: [error] }, status);
      return;
    }

    const request: unknown = http.getRequest();
    const routeNotFound = `Cannot ${adapter.getRequestMethod(request)} ${adapter.getRequestUrl(request)}`;
    if (status === HttpStatus.NOT_FOUND && exception.message === routeNotFound) {
      adapter.reply(
        http.getResponse(),
        { message: 'No route matches the request.', error: 'Not Found', statusCode: status },
        status,
      );
      return;
    }

    super.catch(exception, host);
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
