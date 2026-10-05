import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { Db } from "../database/db";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { hashPassword } from "./password";

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const user = await this.db.one(
      "INSERT INTO users(email, password_hash, display_name) VALUES (?, ?, ?) RETURNING id, email, display_name",
      [
        dto.email.trim().toLowerCase(),
        hashPassword(dto.password),
        dto.displayName,
      ],
    );
    return { user, accessToken: await this.jwt.signAsync({ sub: user!.id }) };
  }
  async login(dto: LoginDto) {
    const user = await this.db.one(
      "SELECT * FROM users WHERE lower(email) = lower(?) AND status = 'ACTIVE'",
      [dto.email],
    );
    const [salt, hash] = (
      user?.password_hash ?? "dummy:" + "00".repeat(64)
    ).split(":");
    if (
      !timingSafeEqual(
        scryptSync(dto.password, salt, 64),
        Buffer.from(hash, "hex"),
      ) ||
      !user
    )
      throw new UnauthorizedException("Invalid credentials");
    return { accessToken: await this.jwt.signAsync({ sub: user.id }) };
  }
}
