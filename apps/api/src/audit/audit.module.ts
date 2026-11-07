import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";

/** Provides AuditService; needs the global PRISMA client from InfrastructureModule. */
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
