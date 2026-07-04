import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Промо-группы: сегменты клиентов с фиксированной скидкой (%) на оплату/продление.
 * Клиента кладут в группу (bulk-действие в админке), скидка применяется при
 * расчёте цены в PaymentsService (createInvoice и payWithBalance).
 */
@Injectable()
export class PromoGroupsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: any) {
    const name = String(dto?.name || '').trim();
    if (!name) throw new BadRequestException('нужно название');
    const discountPct = Math.min(Math.max(Math.round(Number(dto?.discountPct) || 0), 0), 100);
    return this.prisma.promoGroup.create({ data: { name, discountPct, tenantId: dto?.tenantId || null } });
  }

  async list() {
    const groups = await this.prisma.promoGroup.findMany({ orderBy: { createdAt: 'desc' } });
    const counts = await this.prisma.user.groupBy({ by: ['promoGroupId'], _count: { _all: true } });
    const cmap: Record<string, number> = {};
    for (const c of counts) if (c.promoGroupId) cmap[c.promoGroupId] = c._count._all;
    return groups.map((g) => ({ ...g, members: cmap[g.id] || 0 }));
  }

  async update(id: string, dto: any) {
    const data: any = {};
    if (dto?.name != null) data.name = String(dto.name).trim();
    if (dto?.discountPct != null) data.discountPct = Math.min(Math.max(Math.round(Number(dto.discountPct)), 0), 100);
    return this.prisma.promoGroup.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.user.updateMany({ where: { promoGroupId: id }, data: { promoGroupId: null } });
    await this.prisma.promoGroup.delete({ where: { id } });
    return { ok: true };
  }

  /** Скидка (%) для клиента по его группе; 0 если группы нет. */
  async discountPctForUser(user: { promoGroupId?: string | null }): Promise<number> {
    if (!user?.promoGroupId) return 0;
    const g = await this.prisma.promoGroup.findUnique({ where: { id: user.promoGroupId } });
    return g ? Math.min(Math.max(g.discountPct, 0), 100) : 0;
  }

  /** Применить скидку к цене (округление до целого рубля). */
  applyDiscount(price: number, pct: number): number {
    if (!pct) return price;
    return Math.max(0, Math.round((price * (100 - pct)) / 100));
  }
}
