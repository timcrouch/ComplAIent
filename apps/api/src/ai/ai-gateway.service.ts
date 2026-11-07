import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type AiCallPurpose,
  type AiGateway,
  type AiOutcome,
  type AiReadiness,
  type ConnectionTestResult,
  type GatewayCall,
  type GatewayRunResult,
  createGateway,
  createPrismaAiStore,
} from "@isms/ai";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { AI_OPTIONS, type AiModuleOptions } from "./ai-options.js";

/**
 * The API's one way to call AI. Every call goes through readiness first; a refused call is
 * never sent and writes no AiInteraction row. No provider is handed out, so nothing can skip it.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly gateway: AiGateway;

  constructor(@Inject(PRISMA) prisma: PrismaService, @Inject(AI_OPTIONS) options: AiModuleOptions) {
    this.gateway = createGateway({
      store: createPrismaAiStore(prisma),
      secretsKey: options.secretsKey,
      provider: options.provider,
      allowNonEuRouting: options.allowNonEuRouting === true,
      ...(options.providerFactory ? { providerFactory: options.providerFactory } : {}),
      logger: {
        info: (obj, msg) => {
          this.logger.log({ ...obj, msg });
        },
        warn: (obj, msg) => {
          this.logger.warn({ ...obj, msg });
        },
      },
    });
  }

  readiness(purpose: AiCallPurpose): Promise<AiReadiness> {
    return this.gateway.readiness(purpose);
  }

  run<T>(purpose: AiCallPurpose, call: GatewayCall<T>): Promise<GatewayRunResult<T>> {
    return this.gateway.run(purpose, call);
  }

  setOutcome(id: string, outcome: AiOutcome): Promise<void> {
    return this.gateway.setOutcome(id, outcome);
  }

  /** How many items of a run's output were dropped (unknown or duplicate keys). */
  setDiscardedCount(id: string, count: number): Promise<void> {
    return this.gateway.setDiscardedCount(id, count);
  }

  /** Settings screen only. Throws AiKeyUnavailableError or ProviderError. */
  listModels(): Promise<{ id: string; name: string }[]> {
    return this.gateway.listModels();
  }

  /** Settings screen only: the connection test, recorded as purpose connection_test. */
  test(actorUserId: string): Promise<ConnectionTestResult> {
    return this.gateway.test({ actorUserId });
  }
}
