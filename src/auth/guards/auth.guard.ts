import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Db } from "../../database/db";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
    private db: Db,
  ) {}
  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride("public", targets)) return true;
    const req = context.switchToHttp().getRequest();
    try {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (!token) throw new Error();
      const claims = await this.jwt.verifyAsync(token);
      req.user = await this.db.one(
        "SELECT id, role FROM users WHERE id = ? AND status = 'ACTIVE'",
        [claims.sub],
      );
      if (!req.user) throw new Error();
    } catch {
      throw new UnauthorizedException();
    }
    return (
      !this.reflector.getAllAndOverride("admin", targets) ||
      req.user.role === "ADMIN"
    );
  }
}
