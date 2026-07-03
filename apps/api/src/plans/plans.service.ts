import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Тарифы. Несколько на выбор (1/3/6/12 мес, число устройств, цена). Платформенные
 * (tenantId=null) + тарифы франшизы. Если тарифов нет — фолбэк на настройки
 * plan.days/plan.price (обратная совместимость).
 */
@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId?: string) {
    return this.prisma.plan.findMany({
      where: { isActive: true, OR: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])] },
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
    });
  }

  async all() {
    return this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }] });
  }

  async create(dto: any) {
    if (!dto.title || !dto.days || dto.price == null) throw new BadRequestException('нужны title, days, price');
    return this.prisma.plan.create({ data: {
      tenantId: dto.tenantId ?? null, title: dto.title, days: Number(dto.days),
      price: Number(dto.price), deviceLimit: Number(dto.deviceLimit) || 0, sortOrder: Number(dto.sortOrder) || 0,
    } });
  }

  async update(id: string, dto: any) {
    return this.prisma.plan.update({ where: { id }, data: {
      title: dto.title, days: dto.days != null ? Number(dto.days) : undefined,
      price: dto.price != null ? Number(dto.price) : undefined,
      deviceLimit: dto.deviceLimit != null ? Number(dto.deviceLimit) : undefined,
      sortOrder: dto.sortOrder != null ? Number(dto.sortOrder) : undefined,
      isActive: dto.isActive,
    } });
  }

  async remove(id: string) { await this.prisma.plan.delete({ where: { id } }); return { ok: true }; }

  /** Тариф по id (для оплаты). */
  async get(id: string) { return this.prisma.plan.findUnique({ where: { id } }); }
}
