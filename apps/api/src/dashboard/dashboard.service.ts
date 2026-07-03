import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Сводка для дашборда админки: клиенты, ноды, деньги, графики.
 * Доход считаем ТОЛЬКО по реально полученным платежам (status='paid').
 * Оплата с баланса клиента НЕ пишется в Payment (баланс уже был учтён как
 * пополнение) — поэтому двойного счёта дохода нет: «авто ≠ доход».
 */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async summary(tenantId?: string) {
    const T = tenantId ? { tenantId } : {};
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400_000);
    const weekAgo = new Date(now.getTime() - 7 * 86400_000);
    const monthAgo = new Date(now.getTime() - 30 * 86400_000);

    const [total, active, trial, blocked, newDay, newWeek, devices, nodes, nodesOnline] = await Promise.all([
      this.prisma.user.count({ where: { ...T } }),
      this.prisma.user.count({ where: { ...T, isBlocked: false, expireAt: { gt: now } } }),
      this.prisma.user.count({ where: { ...T, isTrial: true, expireAt: { gt: now } } }),
      this.prisma.user.count({ where: { ...T, isBlocked: true } }),
      this.prisma.user.count({ where: { ...T, createdAt: { gte: dayAgo } } }),
      this.prisma.user.count({ where: { ...T, createdAt: { gte: weekAgo } } }),
      this.prisma.device.count({ where: tenantId ? { user: { tenantId } } : {} }),
      this.prisma.node.count({ where: tenantId ? { tenantId } : {} }),
      this.prisma.node.count({ where: { ...(tenantId ? { tenantId } : {}), online: true } }),
    ]);

    const rev = async (since?: Date) => {
      const r = await this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { ...T, status: 'paid', ...(since ? { paidAt: { gte: since } } : {}) },
      });
      return Number(r._sum.amount || 0);
    };
    const [revDay, revWeek, revMonth, revTotal] = await Promise.all([
      rev(dayAgo), rev(weekAgo), rev(monthAgo), rev(),
    ]);

    // график: доход и регистрации по дням за 14 дней
    const days = 14;
    const revByDay = await this.prisma.payment.findMany({
      where: { ...T, status: 'paid', paidAt: { gte: new Date(now.getTime() - days * 86400_000) } },
      select: { amount: true, paidAt: true },
    });
    const signByDay = await this.prisma.user.findMany({
      where: { ...T, createdAt: { gte: new Date(now.getTime() - days * 86400_000) } },
      select: { createdAt: true },
    });
    const chart: { date: string; revenue: number; signups: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      const revenue = revByDay
        .filter((p) => p.paidAt && p.paidAt.toISOString().slice(0, 10) === key)
        .reduce((s, p) => s + Number(p.amount), 0);
      const signups = signByDay.filter((u) => u.createdAt.toISOString().slice(0, 10) === key).length;
      chart.push({ date: key, revenue, signups });
    }

    // последние платежи
    const recent = await this.prisma.payment.findMany({
      where: { ...T, status: 'paid' }, orderBy: { paidAt: 'desc' }, take: 8,
      include: { user: { select: { tgName: true, tgUsername: true } } },
    });

    return {
      users: { total, active, trial, blocked, newDay, newWeek },
      nodes: { total: nodes, online: nodesOnline },
      devices,
      revenue: { day: revDay, week: revWeek, month: revMonth, total: revTotal },
      chart,
      recent: recent.map((p) => ({
        amount: Number(p.amount),
        method: p.method,
        topup: p.topup,
        name: p.user?.tgName || p.user?.tgUsername || '—',
        paidAt: p.paidAt,
      })),
    };
  }
}
