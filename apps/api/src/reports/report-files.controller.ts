import { Controller, Query, Req, Res } from "@nestjs/common";
import { type BoardQuery, type RegisterQuery, type SoaQuery, reportRoutes } from "@isms/contracts";
import type { Request, Response } from "express";
import { type AuditSnapshot, AuditService, auditContextFrom } from "../audit/index.js";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { BoardService } from "./board.service.js";
import { type ReportFileKind, reportFileName } from "./render/common.js";
import { boardPdf, registerPdf, soaPdf } from "./render/pdf.js";
import { registerXlsx, soaXlsx } from "./render/xlsx.js";
import { REGISTER_CAP, REGISTER_PDF_CAP, ReportsService } from "./reports.service.js";
import { SoaService } from "./soa.service.js";

const CONTENT_TYPE = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

type Format = keyof typeof CONTENT_TYPE;

type ReportFile = {
  kind: "register" | "soa" | "board";
  name: ReportFileKind;
  /** Added to the file name, e.g. the SoA's framework version key. */
  nameQualifier?: string | null;
  format: Format;
  /** The filters the report was generated with, as resolved (never any content). */
  filters: AuditSnapshot;
  generatedAt: string;
  body: Buffer;
};

/**
 * The reports as files (§5.1): built on request from the same data as the JSON routes, so the
 * viewer's risk visibility applies. Each download is audited as `report.exported` with its
 * kind, format and filters, and sent as an attachment named by the generation day.
 */
@Controller()
export class ReportFilesController {
  constructor(
    private readonly reports: ReportsService,
    private readonly soaService: SoaService,
    private readonly boardService: BoardService,
    private readonly audit: AuditService,
  ) {}

  @ContractRoute(reportRoutes.registerXlsx)
  registerXlsx(
    @Query() query: RegisterQuery,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.register(actor, query, "xlsx", req, res);
  }

  @ContractRoute(reportRoutes.registerPdf)
  registerPdf(
    @Query() query: RegisterQuery,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.register(actor, query, "pdf", req, res);
  }

  @ContractRoute(reportRoutes.soaXlsx)
  soaXlsx(
    @Query() query: SoaQuery,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.soa(actor, query, "xlsx", req, res);
  }

  @ContractRoute(reportRoutes.soaPdf)
  soaPdf(
    @Query() query: SoaQuery,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return this.soa(actor, query, "pdf", req, res);
  }

  @ContractRoute(reportRoutes.boardPdf)
  async boardPdf(
    @Query() query: BoardQuery,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const pack = await this.boardService.get(actor, query);
    await this.send(req, res, {
      kind: "board",
      name: "board",
      format: "pdf",
      filters: { period: pack.period.key },
      generatedAt: pack.generatedAt,
      body: await boardPdf(pack),
    });
  }

  private async register(
    actor: Actor,
    query: RegisterQuery,
    format: Format,
    req: Request,
    res: Response,
  ): Promise<void> {
    const cap = format === "pdf" ? REGISTER_PDF_CAP : REGISTER_CAP;
    const register = await this.reports.register(actor, query, cap);
    await this.send(req, res, {
      kind: "register",
      name: "risk-register",
      format,
      filters: { filter: register.filter, includeClosed: register.includeClosed },
      generatedAt: register.generatedAt,
      body: format === "xlsx" ? await registerXlsx(register) : await registerPdf(register),
    });
  }

  private async soa(
    actor: Actor,
    query: SoaQuery,
    format: Format,
    req: Request,
    res: Response,
  ): Promise<void> {
    const soa = await this.soaService.get(actor, query);
    await this.send(req, res, {
      kind: "soa",
      name: "soa",
      nameQualifier: soa.framework?.key ?? null,
      format,
      filters: { framework: soa.framework?.key ?? null },
      generatedAt: soa.generatedAt,
      body: format === "xlsx" ? await soaXlsx(soa) : await soaPdf(soa),
    });
  }

  /** Audits the export once the file is built, then sends it whole as an attachment. */
  private async send(req: Request, res: Response, file: ReportFile): Promise<void> {
    await this.audit.record(
      {
        action: "report.exported",
        objectType: "report",
        objectId: file.kind,
        after: { kind: file.kind, format: file.format, filters: file.filters },
      },
      auditContextFrom(req),
    );
    const name = reportFileName(file.name, file.format, file.generatedAt, file.nameQualifier);
    res.status(200);
    res.set({
      "Content-Type": CONTENT_TYPE[file.format],
      "Content-Length": String(file.body.length),
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    res.end(file.body);
  }
}
