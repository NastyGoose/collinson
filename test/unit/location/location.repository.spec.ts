import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { rejected } from '../../support/errors';
import { Prisma } from '../../../src/generated/prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { StorageUnavailableError } from '../../../src/location/location.errors';
import { LocationRepository } from '../../../src/location/location.repository';

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, {
    code,
    clientVersion: '7.10.1',
  });
}

/** A repository whose every Prisma call rejects with `error`. */
async function repositoryFailingWith(error: unknown): Promise<LocationRepository> {
  const fail = jest.fn().mockRejectedValue(error);
  const prisma = {
    location: { findUnique: fail },
    locationSearch: { findUnique: fail },
    $transaction: fail,
    $executeRaw: fail,
  };
  const moduleRef = await Test.createTestingModule({
    providers: [LocationRepository, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return moduleRef.get(LocationRepository);
}

const OPERATIONS: [string, (repository: LocationRepository) => Promise<unknown>][] = [
  ['findLocation', (repository) => repository.findLocation('1')],
  ['findFreshSearch', (repository) => repository.findFreshSearch('berlin', null, new Date())],
  ['saveSearch', (repository) => repository.saveSearch('berlin', null, [], new Date(), new Date())],
  ['purgeExpiredSearches', (repository) => repository.purgeExpiredSearches(new Date())],
];

describe('LocationRepository', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe.each(OPERATIONS)('%s', (_name, operation) => {
    it.each([
      ['an unreachable database (P1001)', knownError('P1001')],
      ['a pool timeout (P2024)', knownError('P2024')],
      ['a write conflict or deadlock (P2034)', knownError('P2034')],
      [
        'an unknown request error',
        new Prisma.PrismaClientUnknownRequestError('boom', { clientVersion: '7.10.1' }),
      ],
    ])('reports %s as STORAGE_UNAVAILABLE and keeps the cause', async (_label, cause) => {
      const error = await rejected(
        operation(await repositoryFailingWith(cause)),
        StorageUnavailableError,
      );

      expect(error.code).toBe('STORAGE_UNAVAILABLE');
      expect(error.cause).toBe(cause);
    });

    it.each([
      ['a unique violation (P2002)', knownError('P2002')],
      ['a programming error', new TypeError('cannot read properties of undefined')],
    ])('rethrows %s unchanged', async (_label, cause) => {
      await expect(operation(await repositoryFailingWith(cause))).rejects.toBe(cause);
    });
  });
});
