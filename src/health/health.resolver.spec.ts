import type { PrismaService } from '../prisma/prisma.service';
import { HealthResolver } from './health.resolver';

function resolverWithDatabase(reachable: boolean): HealthResolver {
  const prisma = { isReachable: jest.fn().mockResolvedValue(reachable) };
  return new HealthResolver(prisma as unknown as PrismaService);
}

describe('HealthResolver', () => {
  it('reports the database UP when PostgreSQL answers', async () => {
    await expect(resolverWithDatabase(true).health()).resolves.toEqual({
      service: 'UP',
      database: 'UP',
    });
  });

  it('reports the database DOWN while the service stays UP', async () => {
    await expect(resolverWithDatabase(false).health()).resolves.toEqual({
      service: 'UP',
      database: 'DOWN',
    });
  });
});
