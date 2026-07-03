import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from '../bridge/bridge.service';
import { VpnDbService } from '../bridge/vpndb.service';
import { CreateUserDto } from './dto/create-user.dto';

/**
 * Клиенты панели. Изоляция по тенанту: (tenantId, tgId) = один аккаунт.
 * Платформенный тенант (kind="platform") создаётся при первом запросе, если
 * тенант не указан явно — так одиночная (не-франшизная) установка работает
 * «из коробки», без обязательного мультитенанта.
 */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private bridge: BridgeService, private vpndb: VpnDbService) {}

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

  /**
   * Список клиентов с поиском и пагинацией (для админки с тысячами юзеров).
   * search — по имени/username/tgId/externalId. Возвращает {rows, total}.
   */
  async findAll(opts: { tenantId?: string; search?: string; limit?: number; offset?: number } = {}) {
    const where: any = {};
    if (opts.tenantId) where.tenantId = opts.tenantId;
    const s = (opts.search || '').trim();
    if (s) {
      const or: any[] = [
        { tgName: { contains: s, mode: 'insensitive' } },
        { tgUsername: { contains: s, mode: 'insensitive' } },
        { externalId: { contains: s, mode: 'insensitive' } },
      ];
      const digits = s.replace(/\D/g, '');
      if (digits) { try { or.push({ tgId: BigInt(digits) }); } catch { /* too big */ } }
      where.OR = or;
    }
    const take = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const skip = Math.max(Number(opts.offset) || 0, 0);
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' }, take, skip,
        include: { tenant: { select: { brand: true, kind: true } }, devices: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { rows, total, limit: take, offset: skip };
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
    const res = await this.prisma.user.update({
      where: { id }, data: { expireAt: next, isTrial: false, remindStage: 0 }, // продлили → напоминания заново
    });
    // проброс в живой бот (vpn_db) + включить ключ при продлении
    if (u.tgId && u.tgId > 0n) {
      await this.vpndb.grantDays(u.tgId.toString(), days);
      if (days > 0 && u.externalId) await this.bridge.setEnabled(u.externalId, true);
    }
    return res;
  }

  async setBlocked(id: string, blocked: boolean) {
    const u = await this.findOne(id);
    const res = await this.prisma.user.update({ where: { id }, data: { isBlocked: blocked } });
    // проброс в живой бэкенд: блок = выключить ключ (+ is_banned в боте), разблок = включить
    if (u.externalId) await this.bridge.setEnabled(u.externalId, !blocked);
    if (u.tgId && u.tgId > 0n) await this.vpndb.setBanned(u.tgId.toString(), blocked);
    return res;
  }

  /** Force-enable: принудительно включить ключ клиента в живом бэкенде (+ снять блок). */
  async forceEnable(id: string) {
    const u = await this.findOne(id);
    await this.prisma.user.update({ where: { id }, data: { isBlocked: false } });
    if (u.externalId) await this.bridge.setEnabled(u.externalId, true);
    return { ok: true };
  }

  /** Выдать ключ клиенту (создать во внешнем бэкенде). */
  async issueKey(id: string) {
    const u = await this.findOne(id);
    if (!u.externalId) throw new BadRequestException('у клиента нет externalId');
    const r = await this.bridge.createKey(u.externalId, u.tgId?.toString());
    return { ok: true, result: r };
  }

  /** Удалить ключ клиента во внешнем бэкенде. */
  async deleteKey(id: string) {
    const u = await this.findOne(id);
    if (!u.externalId) throw new BadRequestException('у клиента нет externalId');
    await this.bridge.deleteKey(u.externalId);
    return { ok: true };
  }

  /** Ручное создание ключа (выдать кому-то без Telegram). tgId — уникальный отрицательный. */
  async createManual(name?: string, days?: number, tenantId?: string) {
    const tid = tenantId ?? (await this.platformTenantId());
    let tgId = 0n;
    for (let i = 0; i < 6; i++) {
      tgId = -BigInt(Math.floor(Math.random() * 1e15) + 1); // отриц. → не пересекается с реальными tg id
      if (!(await this.prisma.user.findFirst({ where: { tenantId: tid, tgId } }))) break;
    }
    let expireAt: Date | null = null;
    if (days && days > 0) { expireAt = new Date(); expireAt.setDate(expireAt.getDate() + days); }
    return this.prisma.user.create({
      data: { tenantId: tid, tgId, tgName: name || 'Ручной ключ', isTrial: false, expireAt },
    });
  }

  /** HWID: клиенты с наибольшим числом устройств (возможный шеринг). */
  async hwidTop() {
    const rows = await this.prisma.userHwid.groupBy({
      by: ['userId'], _count: { _all: true },
      orderBy: { _count: { userId: 'desc' } }, take: 50,
    });
    if (!rows.length) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, tgId: true, tgName: true, tgUsername: true, isBlocked: true },
    });
    const map = Object.fromEntries(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...(map[r.userId] || {}), hwidCount: r._count._all })).filter((x: any) => x.id);
  }

  /** Корректировка баланса (amount может быть отрицательным — списание). */
  async adjustBalance(id: string, amount: number) {
    await this.findOne(id);
    const u = await this.prisma.user.update({ where: { id }, data: { balance: { increment: amount } } });
    return { ok: true, balance: Number(u.balance) };
  }
}
