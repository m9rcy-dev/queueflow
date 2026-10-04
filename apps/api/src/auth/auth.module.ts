import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { MailModule } from "../mail/mail.module";
import { AuthenticatorModule } from "../authenticator/authenticator.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { PinService } from "./pin.service";
import { TokenService } from "./token.service";

@Module({
  imports: [
    MailModule,
    AuthenticatorModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_ACCESS_SECRET") ?? "dev-only-change-me",
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, PinService, JwtStrategy],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
