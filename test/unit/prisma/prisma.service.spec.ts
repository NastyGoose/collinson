import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../../../src/config/config.logic';
import { PrismaModule } from '../../../src/prisma/prisma.module';
import { PrismaService } from '../../../src/prisma/prisma.service';

describe('PrismaService', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    // Never reached: $connect, $disconnect and $queryRaw are stubbed below.
    process.env.DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:1/unit';
  });

  afterAll(() => {
    process.env.DATABASE_URL = originalUrl;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createModule() {
    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnv }),
        PrismaModule,
      ],
    }).compile();
  }

  it('connects on init and disconnects once when the application closes', async () => {
    const connect = jest.spyOn(PrismaService.prototype, '$connect').mockResolvedValue();
    const disconnect = jest.spyOn(PrismaService.prototype, '$disconnect').mockResolvedValue();
    const moduleRef = await createModule();

    await moduleRef.init();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();

    await moduleRef.close();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('provides one client instance across the module graph', async () => {
    jest.spyOn(PrismaService.prototype, '$connect').mockResolvedValue();
    jest.spyOn(PrismaService.prototype, '$disconnect').mockResolvedValue();
    const moduleRef = await createModule();

    expect(moduleRef.get(PrismaService)).toBe(moduleRef.get(PrismaService));
    await moduleRef.close();
  });

  it('reports PostgreSQL as unreachable instead of throwing', async () => {
    jest.spyOn(PrismaService.prototype, '$connect').mockResolvedValue();
    jest.spyOn(PrismaService.prototype, '$disconnect').mockResolvedValue();
    const moduleRef = await createModule();
    const prisma = moduleRef.get(PrismaService);
    jest.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('connection refused'));

    await expect(prisma.isReachable()).resolves.toBe(false);
    await moduleRef.close();
  });
});
