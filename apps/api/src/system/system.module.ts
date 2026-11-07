import { Module } from "@nestjs/common";
import { OBJECT_STORE, type ObjectStore } from "../evidence/index.js";
import { HealthController, OpenApiController } from "./health.controller.js";
import {
  POSTGRES_HEALTH,
  PostgresHealthIndicator,
  REDIS_HEALTH,
  RedisHealthIndicator,
  STORAGE_HEALTH,
  StorageHealthIndicator,
} from "./health-indicators.js";

@Module({
  controllers: [HealthController, OpenApiController],
  providers: [
    { provide: POSTGRES_HEALTH, useClass: PostgresHealthIndicator },
    { provide: REDIS_HEALTH, useClass: RedisHealthIndicator },
    {
      provide: STORAGE_HEALTH,
      useFactory: (store?: ObjectStore) =>
        store === undefined ? null : new StorageHealthIndicator(store),
      inject: [{ token: OBJECT_STORE, optional: true }],
    },
  ],
})
export class SystemModule {}
