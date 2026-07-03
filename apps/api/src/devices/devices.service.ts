import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Устройство = один VLESS-uuid + sub-токен (ссылка подписки). Создание устройства
 * = появление нового ключа, который потом реконсайл разольёт по нодам.
 */
@Injectable()
export class DevicesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, name?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('пользователь не найден');
    // лимит устройств на клиента (настройка device.limit; 0 = без лимита)
    const limRow = await this.prisma.setting.findUnique({ where: { key: 'device.limit' } });
    const limit = limRow ? Number(limRow.value) || 0 : 0;
    if (limit > 0) {
      const count = await this.prisma.device.count({ where: { userId } });
      if (count >= limit) throw new BadRequestException(`достигнут лимит устройств (${limit})`);
    }
    return this.prisma.device.create({
      data: {
        userId,
        name: name || 'Устройство',
        vlessUuid: randomUUID(),
        subToken: randomBytes(24).toString('hex'), // непубличный, длинный
        tvCode: await this.genTvCode(), // короткий код для ТВ
      },
    });
  }

  // короткий код для ТВ: 8 символов без похожих (0/O, 1/I) — удобно вводить пультом
  private async genTvCode(): Promise<string> {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let t = 0; t < 6; t++) {
      const c = Array.from(randomBytes(8)).map((b) => A[b % A.length]).join('');
      if (!(await this.prisma.device.findUnique({ where: { tvCode: c } }))) return c;
    }
    return randomBytes(6).toString('hex').toUpperCase();
  }

  async listForUser(userId: string) {
    return this.prisma.device.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  async remove(id: string) {
    const d = await this.prisma.device.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('устройство не найдено');
    await this.prisma.keySyncStatus.deleteMany({ where: { deviceId: id } });
    await this.prisma.device.delete({ where: { id } });
    return { ok: true };
  }

  /** Все действующие устройства (для реконсайла нод). */
  async allActive() {
    return this.prisma.device.findMany({
      include: { user: { select: { isBlocked: true, expireAt: true, tenantId: true, tgId: true } } },
    });
  }
}
