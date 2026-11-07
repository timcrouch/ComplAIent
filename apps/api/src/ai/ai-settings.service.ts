import { Inject, Injectable } from "@nestjs/common";
import {
  AiKeyUnavailableError,
  type AiModels,
  type AiSettingsRow,
  ProviderError,
  createPrismaAiStore,
  privacyHolds,
  sealSecret,
} from "@isms/ai";
import {
  type AiModelListResponse,
  type AiSettingsDto,
  type AiSettingsUpdateInput,
  type AiTestConnectionResponse,
  type SetAiKeyInput,
  conflictDetail,
} from "@isms/contracts";
import type { Prisma } from "@isms/database";
import { type Clock, DomainError } from "@isms/domain";
import { type AuditContext, AuditService, type AuditSnapshot } from "../audit/index.js";
import { CLOCK } from "../identity/index.js";
import { PRISMA, type PrismaService, validationFailed } from "../platform/index.js";
import { AiGatewayService } from "./ai-gateway.service.js";
import { AI_OPTIONS, type AiModuleOptions } from "./ai-options.js";
import { MODEL_KEYS, modelsDto, toSettingsDto } from "./ai-settings.view.js";

type Tx = Prisma.TransactionClient;

/** Serialises every AI settings write, so each sees what the previous one committed. */
const AI_SETTINGS_LOCK = "isms:ai-settings";
const OBJECT_TYPE = "AiSettings";

const conflict = (message: string, reason: Parameters<typeof conflictDetail>) =>
  new DomainError("CONFLICT", message, [conflictDetail(...reason)]);

const privacyOff = () =>
  conflict("Models can be chosen only with EU routing and zero retention on", [
    "aiUnavailable",
    "privacyOff",
  ]);

/** Maps a key or provider failure while listing models to a 409 reason. */
function listingConflict(error: unknown): DomainError {
  if (error instanceof AiKeyUnavailableError) {
    if (error.reason === "noKey")
      return conflict("No provider key is set", ["aiUnavailable", "noKey"]);
    return conflict("The provider key cannot be used", [error.reason]);
  }
  if (error instanceof ProviderError) {
    return conflict("The AI provider did not list models", ["aiUnavailable", error.kind]);
  }
  throw error;
}

/** Administrator AI settings (spec §11.1): write-only key, switches, models and the test. */
@Injectable()
export class AiSettingsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AI_OPTIONS) private readonly options: AiModuleOptions,
    private readonly audit: AuditService,
    private readonly gateway: AiGatewayService,
  ) {}

  get(): Promise<AiSettingsDto> {
    return this.prisma.$transaction((tx) => this.view(tx));
  }

  /** Seals and saves the key. Without AI_SECRETS_KEY nothing is saved (P3-R10). */
  async setKey(input: SetAiKeyInput, actorUserId: string, ctx: AuditContext) {
    const { secretsKey } = this.options;
    if (!secretsKey) {
      throw conflict("AI_SECRETS_KEY is not configured", ["secretsKeyMissing"]);
    }
    const sealedKey = new Uint8Array(sealSecret(input.key, secretsKey));
    const last4 = input.key.slice(-4);
    return this.write(async (tx, current, id) => {
      const key = {
        sealedKey,
        keyLast4: last4,
        keySetById: actorUserId,
        keySetAt: this.clock.now(),
      };
      await tx.aiSettings.update({
        where: { id },
        data: { ...key, updatedById: actorUserId },
        select: { id: true },
      });
      const replaced = current.sealedKey !== null && current.keyLast4 !== null;
      await this.audit.record(
        {
          action: replaced ? "ai.key_replaced" : "ai.key_set",
          objectType: OBJECT_TYPE,
          objectId: id,
          before: replaced ? { last4: current.keyLast4 } : undefined,
          after: { last4 },
        },
        ctx,
        tx,
      );
    });
  }

  /** Removes the key. Nothing to remove: nothing changes and nothing is audited. */
  async removeKey(actorUserId: string, ctx: AuditContext) {
    return this.write(async (tx, current, id) => {
      if (current.sealedKey === null) return;
      await tx.aiSettings.update({
        where: { id },
        data: {
          sealedKey: null,
          keyLast4: null,
          keySetById: null,
          keySetAt: null,
          updatedById: actorUserId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: "ai.key_removed",
          objectType: OBJECT_TYPE,
          objectId: id,
          before: { last4: current.keyLast4 },
        },
        ctx,
        tx,
      );
    });
  }

  /**
   * Changes switches and models. A chosen model must be listed by the provider at save time,
   * and models can be chosen only while the privacy settings hold, before and after the save.
   */
  async update(input: AiSettingsUpdateInput, actorUserId: string, ctx: AuditContext) {
    const chosen = MODEL_KEYS.filter((k) => typeof input.models?.[k] === "string");
    const keepsPrivacy = (s: AiSettingsRow) =>
      this.privacyHolds(s) &&
      this.privacyHolds({
        euOnly: input.euOnly ?? true,
        zeroRetention: input.zeroRetention ?? true,
      });
    if (chosen.length > 0) {
      if (!keepsPrivacy(await this.load(this.prisma))) throw privacyOff();
      const offered = new Set((await this.offeredModels()).map((m) => m.id));
      const unknown = chosen.filter((k) => !offered.has(input.models?.[k] ?? ""));
      if (unknown.length > 0) {
        throw validationFailed(
          unknown.map((k) => ({
            path: `models.${k}`,
            message: "The provider does not offer this model under the privacy settings",
          })),
        );
      }
    }
    return this.write(async (tx, current, id) => {
      // Re-checked under the lock: privacy may have been turned off since the listing.
      if (chosen.length > 0 && !keepsPrivacy(current)) throw privacyOff();
      const { before, after, models } = diff(current, input);
      if (Object.keys(after).length === 0) return;
      await tx.aiSettings.update({
        where: { id },
        data: {
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.euOnly === undefined ? {} : { euOnly: input.euOnly }),
          ...(input.zeroRetention === undefined ? {} : { zeroRetention: input.zeroRetention }),
          models,
          updatedById: actorUserId,
        },
        select: { id: true },
      });
      await this.audit.record(
        { action: "ai.settings_changed", objectType: OBJECT_TYPE, objectId: id, before, after },
        ctx,
        tx,
      );
    });
  }

  async listModels(): Promise<AiModelListResponse> {
    const settings = await this.load(this.prisma);
    if (!this.privacyHolds(settings)) throw privacyOff();
    return { models: await this.offeredModels() };
  }

  /** Runs the connection test, then audits its result (ok or the reason) only. */
  async test(actorUserId: string, ctx: AuditContext): Promise<AiTestConnectionResponse> {
    const result = await this.gateway.test(actorUserId);
    await this.write(async (tx, _current, id) => {
      await this.audit.record(
        {
          action: "ai.connection_tested",
          objectType: OBJECT_TYPE,
          objectId: id,
          after: result.ok ? { ok: true } : { ok: false, reason: result.reason },
        },
        ctx,
        tx,
      );
    });
    return result;
  }

  private async offeredModels(): Promise<{ id: string; name: string }[]> {
    try {
      return await this.gateway.listModels();
    } catch (error) {
      throw listingConflict(error);
    }
  }

  /** Zero retention and, unless the development opt-in is set, EU-only routing. */
  private privacyHolds(s: Pick<AiSettingsRow, "euOnly" | "zeroRetention">): boolean {
    return privacyHolds(s, { allowNonEuRouting: this.options.allowNonEuRouting === true });
  }

  private load(db: Tx | PrismaService): Promise<AiSettingsRow> {
    return createPrismaAiStore(db).loadSettings();
  }

  /** One locked transaction: ensures the settings row, applies `fn`, returns the new view. */
  private write(
    fn: (tx: Tx, current: AiSettingsRow, id: string) => Promise<void>,
  ): Promise<AiSettingsDto> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${AI_SETTINGS_LOCK}))`;
        // findFirst, not findUnique: Prisma batches same-tick findUnique calls into one query
        // with `singleton: { in: [...] }`, and a Boolean field has no `in` filter.
        const row =
          (await tx.aiSettings.findFirst({ where: { singleton: true }, select: { id: true } })) ??
          (await tx.aiSettings.create({ data: { singleton: true }, select: { id: true } }));
        await fn(tx, await this.load(tx), row.id);
        return this.view(tx);
      },
      { timeout: 15_000 },
    );
  }

  private async view(tx: Tx): Promise<AiSettingsDto> {
    const settings = await this.load(tx);
    const setBy = settings.keySetById
      ? await tx.user.findUnique({
          where: { id: settings.keySetById },
          select: { id: true, displayName: true },
        })
      : null;
    return toSettingsDto(settings, setBy, this.options);
  }
}

/** Before and after of the changed switches and models only, plus the models to store. */
function diff(current: AiSettingsRow, input: AiSettingsUpdateInput) {
  const before: Record<string, AuditSnapshot[string]> = {};
  const after: Record<string, AuditSnapshot[string]> = {};
  for (const key of ["enabled", "euOnly", "zeroRetention"] as const) {
    const next = input[key];
    if (next !== undefined && next !== current[key]) {
      before[key] = current[key];
      after[key] = next;
    }
  }
  const was = modelsDto(current);
  const models: AiModels = {};
  const modelsBefore: Record<string, string | null> = {};
  const modelsAfter: Record<string, string | null> = {};
  for (const key of MODEL_KEYS) {
    const next = input.models?.[key];
    const value = next === undefined ? was[key] : next;
    if (value !== null) models[key] = value;
    if (next === undefined || next === was[key]) continue;
    modelsBefore[key] = was[key];
    modelsAfter[key] = next;
  }
  if (Object.keys(modelsAfter).length > 0) {
    before["models"] = modelsBefore;
    after["models"] = modelsAfter;
  }
  return { before, after, models };
}
