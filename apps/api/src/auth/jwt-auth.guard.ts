import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const h = (req.headers['authorization'] || '') as string;
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new UnauthorizedException();
    try { req.user = this.jwt.verify(token); return true; }
    catch { throw new UnauthorizedException(); }
  }
}
