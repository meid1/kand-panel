import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';

// поля, которые НИКОГДА не пишем в аудит (секреты)
const SECRET_RE = /pass|secret|token|key|pvk|bundle|sign|jwt/i;

/**
 * Аудит изменяющих действий администратора. Логируем только POST/PUT/PATCH/DELETE
 * от аутентифицированных запросов (req.user выставлен JwtAuthGuard) — публичные
 * (подписка/вебхуки) не пишем. Тело чистим от секретов. Пишем в фоне (не блокируем).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    return next.handle().pipe(
      tap(() => {
        if (!mutating || !req.user) return; // только админ-действия
        this.write(req).catch(() => {});
      }),
    );
  }

  private scrub(body: any): string | null {
    if (!body || typeof body !== 'object') return null;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      out[k] = SECRET_RE.test(k) ? '***' : (typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v);
    }
    return JSON.stringify(out).slice(0, 1000);
  }

  private async write(req: any) {
    const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').toString().trim();
    await this.prisma.auditLog.create({
      data: {
        actor: 'admin',
        action: `${req.method} ${req.route?.path || req.url}`,
        target: req.params?.id ?? null,
        ip: ip || null,
        meta: this.scrub(req.body),
      },
    });
  }
}
