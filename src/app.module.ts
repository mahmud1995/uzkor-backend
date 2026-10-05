import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import config from "./database/mikro-orm.config";
import { Db } from "./database/db";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { AuthGuard } from "./auth/guards/auth.guard";
import { AdminCatalogController, CatalogController } from "./catalog/catalog";
import { CommerceController, PaymentsController } from "./commerce/controller";
import { CommerceService } from "./commerce/service";
import { CommerceJobs } from "./commerce/jobs";
@Module({
  imports: [
    MikroOrmModule.forRoot(config),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: "1h",
        issuer: "preorder-commerce",
        audience: "preorder-commerce",
      },
      verifyOptions: {
        issuer: "preorder-commerce",
        audience: "preorder-commerce",
      },
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AuthController,
    CatalogController,
    AdminCatalogController,
    CommerceController,
    PaymentsController,
  ],
  providers: [
    Db,
    AuthService,
    CommerceService,
    CommerceJobs,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
