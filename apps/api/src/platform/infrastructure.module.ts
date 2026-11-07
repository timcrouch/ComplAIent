import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createPrismaClient } from "@isms/database";
import { type JobsClient, createJobsClient } from "@isms/jobs";
import { Redis } from "ioredis";

export type PrismaService = ReturnType<typeof createPrismaClient>;

export const PRISMA = Symbol("PRISMA");
export const REDIS = Symbol("REDIS");
/** The BullMQ producer; the worker runs the jobs it enqueues. */
export const JOBS = Symbol("JOBS");

export type InfrastructureOptions = {
  databaseUrl: string;
  redisUrl: string;
  /** BullMQ key prefix; tests set their own so no worker picks their jobs up. */
  jobsPrefix?: string;
  /** Test seam: replaces the BullMQ producer. */
  jobs?: () => JobsClient;
};

@Injectable()
class InfrastructureShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(JOBS) private readonly jobs: JobsClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.prisma.$disconnect(), this.redis.quit(), this.jobs.close()]);
  }
}

/** Owns the shared database and Redis clients so feature modules inject them by token. */
@Global()
@Module({})
export class InfrastructureModule {
  static forRoot(options: InfrastructureOptions): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [
        {
          provide: PRISMA,
          useFactory: () => createPrismaClient(options.databaseUrl),
        },
        {
          provide: REDIS,
          useFactory: () => {
            const redis = new Redis(options.redisUrl, {
              maxRetriesPerRequest: 1,
            });
            // Connection failures surface through the readiness check; without a listener
            // ioredis would print every reconnect attempt as an unhandled error event.
            redis.on("error", () => undefined);
            return redis;
          },
        },
        {
          provide: JOBS,
          useFactory: () =>
            options.jobs?.() ??
            createJobsClient({
              redisUrl: options.redisUrl,
              failFast: true,
              ...(options.jobsPrefix === undefined ? {} : { prefix: options.jobsPrefix }),
            }),
        },
        InfrastructureShutdown,
      ],
      exports: [PRISMA, REDIS, JOBS],
    };
  }
}
