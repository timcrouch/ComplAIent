import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  type DemoConfirmInput,
  type DemoLoadResponse,
  type DemoStatusResponse,
  conflictDetail,
} from "@isms/contracts";
import type { PrismaClient } from "@isms/database";
import { type DemoActor, type DemoPorts, loadSample, resetInstance } from "@isms/demo";
import { type Clock, DomainError } from "@isms/domain";
import { type Actor, CLOCK } from "../identity/index.js";
import { PRISMA, type PrismaService } from "../platform/index.js";
import { DEMO_OPTIONS, DEMO_OWNER_DB, DEMO_PORTS, type DemoModuleOptions } from "./demo.tokens.js";

/** Typed when no organisation is set up yet. */
export const RESET_WORD = "RESET";

/**
 * Sample data and reset (spec §5.1-§5.4), over `@isms/demo`. Both actions run as the owner
 * role and end every session, the caller's included; they audit themselves (`demo.reset`,
 * `demo.sample_loaded`) by the caller's email, since their user row does not survive.
 */
@Injectable()
export class DemoService implements OnModuleDestroy {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(DEMO_OWNER_DB) private readonly ownerDb: PrismaClient,
    @Inject(DEMO_PORTS) private readonly ports: DemoPorts,
    @Inject(DEMO_OPTIONS) private readonly options: DemoModuleOptions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.ownerDb.$disconnect();
  }

  async status(): Promise<DemoStatusResponse> {
    return { enabled: true, organisationName: await this.organisationName() };
  }

  async reset(input: DemoConfirmInput, actor: Actor): Promise<void> {
    await this.checkConfirmation(input.confirm);
    await resetInstance(this.ownerDb, this.ports, await this.demoActor(actor));
  }

  async loadSample(input: DemoConfirmInput, actor: Actor): Promise<DemoLoadResponse> {
    await this.checkConfirmation(input.confirm);
    return loadSample(this.ownerDb, this.ports, await this.demoActor(actor), {
      now: this.clock.now(),
      bootstrapEmail: this.options.bootstrapAdminEmail,
    });
  }

  private async organisationName(): Promise<string | null> {
    const org = await this.prisma.organisation.findFirst({ select: { name: true } });
    return org?.name ?? null;
  }

  /** Trimmed, case-sensitive: the organisation name, or RESET when there is none. */
  private async checkConfirmation(confirm: string): Promise<void> {
    const expected = (await this.organisationName()) ?? RESET_WORD;
    if (confirm.trim() !== expected) {
      throw new DomainError("VALIDATION_FAILED", "Request validation failed", [
        conflictDetail("confirmationMismatch"),
      ]);
    }
  }

  /**
   * The caller with their exact issuer and subject, so the load recreates their user row as
   * the same sign-in and they keep administrator without a claim (Review Focus 1).
   */
  private async demoActor(actor: Actor): Promise<DemoActor> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { idpIssuer: true, idpSubject: true },
    });
    return { email: actor.email, idpIssuer: user.idpIssuer, idpSubject: user.idpSubject };
  }
}
