import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { BypassService } from '../bypass/bypass.service';

/**
 * Промокоды. Типы: days (начислить дни), bypass_gb (докупить ГБ обхода),
 * balance (пополнить баланс/кошелёк). Защита: лимит использований (maxUses) +
 * один юзер гасит код один раз (PromoRedemption). Погашает клиент в боте.
 */
@Injectable()
export class PromoService {
  constructor(private prisma: PrismaService, private users: UsersService, private bypass: BypassService) {}

  async create(dto: any) {
    if (!dto.code || !dto.type || dto.value == null) throw new BadRequestException('нужны code, type, value');
    if (!['days', 'bypass_gb', 'balance'].includes(dto.type)) throw new BadRequestException('type: days|bypass_gb|balance');
    const code = String(dto.code).trim().toUpperCase();
    if (await this.prisma.promoCode.findUnique({ where: { code } })) throw new BadRequestException('такой код уже есть');
    return this.prisma.promoCode.create({ data: {
      code, type: dto.type, value: Number(dto.value), maxUses: Number(dto.maxUses) || 1,
    } });
  }

  async list() { return this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } }); }
  async remove(id: string) { await this.prisma.promoCode.delete({ where: { id } }); return { ok: true }; }

  async update(id: string, dto: any) {
    const data: any = {};
    if (dto.type) {
      if (!['days', 'bypass_gb', 'balance'].includes(dto.type)) throw new BadRequestException('type: days|bypass_gb|balance');
      data.type = dto.type;
    }
    if (dto.value != null) data.value = Number(dto.value);
    if (dto.maxUses != null) data.maxUses = Number(dto.maxUses);
    return this.prisma.promoCode.update({ where: { id }, data });
  }

  /** Погашение кода клиентом. Возвращает {ok, message}. */
  async redeem(userId: string, codeRaw: string) {
    const code = String(codeRaw || '').trim().toUpperCase();
    const promo = await this.prisma.promoCode.findUnique({ where: { code } });
    if (!promo) throw new NotFoundException('промокод не найден');
    if (promo.usedCount >= promo.maxUses) throw new BadRequestException('промокод исчерпан');
    // один юзер — один раз (атомарно через unique)
    try {
      await this.prisma.promoRedemption.create({ data: { promoCodeId: promo.id, userId } });
    } catch { throw new BadRequestException('вы уже активировали этот код'); }
    await this.prisma.promoCode.update({ where: { id: promo.id }, data: { usedCount: { increment: 1 } } });
    // применяем
    let message = '';
    if (promo.type === 'days') { await this.users.grantDays(userId, promo.value); message = `+${promo.value} дней подписки`; }
    else if (promo.type === 'bypass_gb') { await this.bypass.addGb(userId, promo.value); message = `+${promo.value} ГБ обхода`; }
    else if (promo.type === 'balance') { await this.prisma.user.update({ where: { id: userId }, data: { balance: { increment: promo.value } } }); message = `+${promo.value} на баланс`; }
    return { ok: true, message };
  }
}
