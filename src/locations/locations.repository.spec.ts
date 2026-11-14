import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StorageUnavailableError } from './location.errors';
import { LocationsRepository } from './locations.repository';

describe('LocationsRepository', () => {
  it('reports a database failure as STORAGE_UNAVAILABLE and keeps the cause', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementationOnce(() => undefined);
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const prisma = { location: { findUnique: jest.fn().mockRejectedValue(cause) } };
    const moduleRef = await Test.createTestingModule({
      providers: [LocationsRepository, { provide: PrismaService, useValue: prisma }],
    }).compile();

    const error: unknown = await moduleRef
      .get(LocationsRepository)
      .findLocation('1')
      .catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(error).toMatchObject({ code: 'STORAGE_UNAVAILABLE', cause });
  });
});
