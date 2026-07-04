import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/**
 * Подарочные подписки. Админ выпускает код (или пачку кодов) на N дней —
 * клиент активирует его в боте и получает эти дни. Один код = одна активация
 * (атомарно через updateMany where redeemedBy=null — защита от гонки).
 */
@Injectable()
export class GiftsService {
  constructor(private prisma: PrismaService, private users: UsersService) {}

  private genCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих 0/O, 1/I
    const b = randomBytes(6);
    let s = '';
    for (let i = 0; i < 6; i++) s += a[b[i] % a.length];
    return 'GIFT-' + s;
  }

  /** Выпуск. days обязателен; code опционален (иначе генерим); count — сколько кодов (1..100). */
  async create(dto: any) {
    const days = Number(dto.days);
    if (!days || days <= 0) throw new BadRequestException('нужно days > 0');
    // явный код — только один
    if (dto.code) {
      const code = String(dto.code).trim().toUpperCase();
      if (await this.prisma.giftCode.findUnique({ where: { code } })) throw new BadRequestException('такой код уже есть');
      return [await this.prisma.giftCode.create({ data: { code, days, buyerId: dto.buyerId || null, tenantId: dto.tenantId || null } })];
    }
    const count = Math.min(Math.max(Number(dto.count) || 1, 1), 100);
    const out: any[] = [];
    for (let i = 0; i < count; i++) {
      // до 5 попыток на случай коллизии кода
      for (let t = 0; t < 5; t++) {
        const code = this.genCode();
        if (await this.prisma.giftCode.findUnique({ where: { code } })) continue;
        out.push(await this.prisma.giftCode.create({ data: { code, days, buyerId: dto.buyerId || null, tenantId: dto.tenantId || null } }));
        break;
      }
    }
    return out;
  }

  async list() { return this.prisma.giftCode.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }); }

  async remove(id: string) {
    const g = await this.prisma.giftCode.findUnique({ where: { id } });
    if (g?.redeemedBy) throw new BadRequestException('нельзя удалить уже активированный подарок');
    await this.prisma.giftCode.delete({ where: { id } });
    return { ok: true };
  }

  /** Активация клиентом в боте. Возвращает {ok, message}. */
  async redeem(userId: string, codeRaw: string) {
    const code = String(codeRaw || '').trim().toUpperCase();
    const gift = await this.prisma.giftCode.findUnique({ where: { code } });
    if (!gift) throw new NotFoundException('подарочный код не найден');
    if (gift.redeemedBy) throw new BadRequestException('этот подарок уже активирован');
    // атомарно застолбить (защита от двойной активации)
    const res = await this.prisma.giftCode.updateMany({
      where: { id: gift.id, redeemedBy: null },
      data: { redeemedBy: userId, redeemedAt: new Date() },
    });
    if (res.count === 0) throw new BadRequestException('этот подарок уже активирован');
    await this.users.grantDays(userId, gift.days);
    return { ok: true, message: `+${gift.days} дней подписки (подарок)` };
  }
}
