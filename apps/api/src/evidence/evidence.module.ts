import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { AuditModule } from "../audit/index.js";
import { RisksModule } from "../risks/index.js";
import { EvidenceController } from "./evidence.controller.js";
import { EvidenceService } from "./evidence.service.js";
import {
  OBJECT_STORE,
  type ObjectStore,
  type StorageSettings,
  createS3ObjectStore,
} from "./object-store.js";
import { TasksService } from "./tasks.service.js";

export type EvidenceModuleOptions = {
  storage: StorageSettings;
  /** Test seam: replaces the S3 store. */
  objectStore?: () => ObjectStore;
};

@Injectable()
class ObjectStoreShutdown implements OnApplicationShutdown {
  constructor(@Inject(OBJECT_STORE) private readonly store: ObjectStore) {}

  onApplicationShutdown(): void {
    this.store.close();
  }
}

/**
 * Evidence files and evidence requests. Global so the readiness check can reach the object
 * store. Needs the global AuthorizationModule (PolicyService) and PRISMA.
 */
@Module({})
export class EvidenceModule {
  static forRoot(options: EvidenceModuleOptions): DynamicModule {
    return {
      module: EvidenceModule,
      global: true,
      imports: [AuditModule, RisksModule],
      controllers: [EvidenceController],
      providers: [
        {
          provide: OBJECT_STORE,
          useFactory: () => options.objectStore?.() ?? createS3ObjectStore(options.storage),
        },
        ObjectStoreShutdown,
        EvidenceService,
        TasksService,
      ],
      exports: [OBJECT_STORE],
    };
  }
}
