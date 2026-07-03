import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

/**
 * Клиенты панели. Изоляция по тенанту: (tenantId, tgId) = один аккаунт.
 * Платформенный тенант (kind="platform") создаётся при первом запросе, если
 * тенант не указан явно — так одиночная (не-франшизная) установка работает
 * «из коробки», без обязательного мультитенанта.
 */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** id платформенного тенанта (создаётся один раз). */
  async platformTenantId(): Promise<string> {
    const existing = await this.prisma.tenant.findFirst({ where: { kind: 'platform' } });
    if (existing) return existing.id;
    const t = await this.prisma.tenant.create({
      data: { kind: 'platform', brand: 'VPN' },
    });
    return t.id;
  }

  async create(dto: CreateUserDto) {
    const tenantId = dto.tenantId ?? (await this.platformTenantId());
    const dup = await this.prisma.user.findUnique({
      where: { tenantId_tgId: { tenantId, tgId: BigInt(dto.tgId) } },
    });
    if (dup) throw new BadRequestException('пользователь уже существует в этом тенанте');

    let expireAt: Date | null = null;
    if (dto.trialDays && dto.trialDays > 0) {
      expireAt = new Date(0);
      expireAt.setTime(await this.nowMs() + dto.trialDays * 86400_000);
    }
    return this.prisma.user.create({
      data: {
        tenantId,
        tgId: BigInt(dto.tgId),
        tgUsername: dto.tgUsername,
        tgName: dto.tgName,
        expireAt,
        isTrial: !!dto.trialDays,
      },
    });
  }

  /** Найти-или-создать клиента по tgId (для бота). Новому — триал (trial.days). */
  async ensure(tgId: number | string, info: { username?: string; name?: string } = {}, tenantId?: string) {
    const tid = tenantId ?? (await this.platformTenantId());
    const tg = BigInt(tgId);
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_tgId: { tenantId: tid, tgId: tg } },
    });
    if (existing) return { user: existing, isNew: false };
    const s = await this.prisma.setting.findUnique({ where: { key: 'trial.days' } });
    const trialDays = s ? Number(s.value) || 0 : 0;
    let expireAt: Date | null = null;
    if (trialDays > 0) { expireAt = new Date(); expireAt.setDate(expireAt.getDate() + trialDays); }
    const user = await this.prisma.user.create({
      data: {
        tenantId: tid, tgId: tg, tgUsername: info.username, tgName: info.name,
        expireAt, isTrial: trialDays > 0, trialUsed: trialDays > 0,
      },
    });
    return { user, isNew: true };
  }

  // «сейчас» из БД — избегаем Date.now() в бизнес-логике панели детерминизма ради
  private async nowMs(): Promise<number> {
    const r = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT now() as now`;
    return new Date(r[0].now).getTime();
  }

  async findAll(tenantId?: string) {
    return this.prisma.user.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { tenant: { select: { brand: true, kind: true } }, devices: true },
    });
  }

  async findOne(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: { tenant: { select: { brand: true, kind: true } }, devices: true, bypass: true },
    });
    if (!u) throw new NotFoundException('пользователь не найден');
    return u;
  }

  /** Начислить/списать дни. Списание (days<0) — без уведомления клиента. */
  async grantDays(id: string, days: number) {
    const u = await this.findOne(id);
    const base = u.expireAt && u.expireAt.getTime() > (await this.nowMs())
      ? u.expireAt.getTime()
      : await this.nowMs();
    const next = new Date(0);
    next.setTime(base + days * 86400_000);
    return this.prisma.user.update({
      where: { id }, data: { expireAt: next, isTrial: false, remindStage: 0 }, // продлили → напоминания заново
    });
  }

  async setBlocked(id: string, blocked: boolean) {
    await this.findOne(id);
    return this.prisma.user.update({ where: { id }, data: { isBlocked: blocked } });
  }

  /** Корректировка баланса (amount может быть отрицательным — списание). */
  async adjustBalance(id: string, amount: number) {
    await this.findOne(id);
    const u = await this.prisma.user.update({ where: { id }, data: { balance: { increment: amount } } });
    return { ok: true, balance: Number(u.balance) };
  }
}
