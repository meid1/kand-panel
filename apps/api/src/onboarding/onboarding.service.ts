import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';

/**
 * Мастер первой настройки: 5 шагов, каждый со своим критерием «готово».
 * Пока не все шаги пройдены — в дашборде показывается карточка «Быстрый старт».
 */
@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService, private payments: PaymentsService) {}

  async status() {
    const setting = async (key: string) => (await this.prisma.setting.findUnique({ where: { key } }))?.value;
    const [nodes, plans, botToken, brand, providers] = await Promise.all([
      this.prisma.node.count(),
      this.prisma.plan.count(),
      setting('bot.token'),
      setting('brand'),
      this.payments.available(),
    ]);
    const steps = {
      servers: nodes > 0,
      plans: plans > 0,
      payments: (providers || []).length > 0,
      bot: !!botToken,
      brand: !!(brand && brand !== 'VPN'),
    };
    const done = Object.values(steps).filter(Boolean).length;
    return { steps, done, total: Object.keys(steps).length, complete: done === Object.keys(steps).length };
  }
}
