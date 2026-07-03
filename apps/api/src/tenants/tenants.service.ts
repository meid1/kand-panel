import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenant.dto';

/**
 * Франшизы (реселлеры) — ОПЦИОНАЛЬНЫЙ модуль. По умолчанию панель одиночная
 * (есть только платформенный тенант). Франшиза = отдельный бренд/бот/домен со
 * своей изоляцией клиентов (tenantId). Бренд НИКОГДА не хардкодится — резолвится
 * из тенанта (byDomain для мультидоменности). Это by design закрывает баг
 * «утечки бренда» из Python-версии.
 */
@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateTenantDto) {
    if (dto.domain) await this.assertDomainFree(dto.domain);
    return this.prisma.tenant.create({
      data: {
        kind: 'franchise',
        brand: dto.brand,
        brandColor: dto.brandColor,
        ownerTgId: dto.ownerTgId != null ? BigInt(dto.ownerTgId) : null,
        botToken: dto.botToken,
        botUsername: dto.botUsername,
        domain: dto.domain,
        domainVerified: false,
        sharePercent: dto.sharePercent ?? 50,
        pricePerMonth: dto.pricePerMonth ?? 90,
        welcomeText: dto.welcomeText,
      },
    });
  }

  private async assertDomainFree(domain: string) {
    const dup = await this.prisma.tenant.findUnique({ where: { domain } });
    if (dup) throw new BadRequestException('домен уже привязан к другой франшизе');
  }

  /** Только франшизы (платформенный тенант в списке не показываем). */
  async findAll() {
    return this.prisma.tenant.findMany({
      where: { kind: 'franchise' },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true, nodes: true } } },
    });
  }

  async findOne(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('франшиза не найдена');
    return t;
  }

  async update(id: string, dto: UpdateTenantDto) {
    const t = await this.findOne(id);
    if (dto.domain && dto.domain !== t.domain) {
      await this.assertDomainFree(dto.domain);
      // при смене домена сбрасываем подтверждение (нужен повторный выпуск HTTPS)
      (dto as any).domainVerified = false;
    }
    return this.prisma.tenant.update({
      where: { id },
      data: {
        ...dto,
        ownerTgId: dto.ownerTgId != null ? BigInt(dto.ownerTgId) : undefined,
      },
    });
  }

  async remove(id: string) {
    const t = await this.findOne(id);
    if (t.kind === 'platform') throw new BadRequestException('нельзя удалить платформенный тенант');
    const users = await this.prisma.user.count({ where: { tenantId: id } });
    if (users > 0) throw new BadRequestException(`у франшизы ${users} клиентов — сначала перенеси/удали их`);
    await this.prisma.tenant.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Финансы франшиз (выплаты/доля). Для каждой франшизы: сколько денег получено
   * (paid-платежи её тенанта), доля франшизы (sharePercent%) и доля платформы.
   * Оплата с баланса не пишется в Payment → авто не задваивает доход.
   */
  async finance() {
    const tenants = await this.prisma.tenant.findMany({
      where: { kind: 'franchise' },
      include: { _count: { select: { users: true, nodes: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const monthAgo = new Date(Date.now() - 30 * 86400_000);
    const rows = [];
    let totFranchise = 0, totPlatform = 0;
    for (const t of tenants) {
      const all = await this.prisma.payment.aggregate({
        _sum: { amount: true }, where: { tenantId: t.id, status: 'paid' },
      });
      const month = await this.prisma.payment.aggregate({
        _sum: { amount: true }, where: { tenantId: t.id, status: 'paid', paidAt: { gte: monthAgo } },
      });
      const revenue = Number(all._sum.amount || 0);
      const revenueMonth = Number(month._sum.amount || 0);
      const share = t.sharePercent ?? 50;
      const franchiseEarn = Math.round(revenue * share / 100);
      const platformEarn = revenue - franchiseEarn;
      totFranchise += franchiseEarn; totPlatform += platformEarn;
      rows.push({
        id: t.id, brand: t.brand, domain: t.domain, isActive: t.isActive,
        users: t._count.users, nodes: t._count.nodes,
        sharePercent: share, revenue, revenueMonth,
        franchiseEarn, platformEarn,
      });
    }
    return { rows, totals: { franchise: totFranchise, platform: totPlatform } };
  }

  /** Резолвер бренда по домену (для подписки/лендинга/бота на кастом-домене). */
  async byDomain(domain: string) {
    const d = (domain || '').toLowerCase().replace(/:\d+$/, '');
    return this.prisma.tenant.findFirst({ where: { domain: d, isActive: true } });
  }
}
