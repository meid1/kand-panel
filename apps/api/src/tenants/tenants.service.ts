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

  /** Резолвер бренда по домену (для подписки/лендинга/бота на кастом-домене). */
  async byDomain(domain: string) {
    const d = (domain || '').toLowerCase().replace(/:\d+$/, '');
    return this.prisma.tenant.findFirst({ where: { domain: d, isActive: true } });
  }
}
