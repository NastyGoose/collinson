import { Query, Resolver } from '@nestjs/graphql';
import { PrismaService } from '../prisma/prisma.service';

export type HealthStatus = 'UP' | 'DOWN';

export interface Health {
  service: HealthStatus;
  database: HealthStatus;
}

@Resolver('Health')
export class HealthResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query('health')
  async health(): Promise<Health> {
    const databaseUp = await this.prisma.isReachable();
    return { service: 'UP', database: databaseUp ? 'UP' : 'DOWN' };
  }
}
