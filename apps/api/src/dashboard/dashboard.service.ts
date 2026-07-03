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
    const twoMonthAgo = new Date(now.getTime() - 60 * 86400_000);

    const [total, active, trial, blocked, newDay, newWeek, devices, nodes, nodesOnline, withDevice, expiredMonth] = await Promise.all([
      this.prisma.user.count({ where: { ...T } }),
      this.prisma.user.count({ where: { ...T, isBlocked: false, expireAt: { gt: now } } }),
      this.prisma.user.count({ where: { ...T, isTrial: true, expireAt: { gt: now } } }),
      this.prisma.user.count({ where: { ...T, isBlocked: true } }),
      this.prisma.user.count({ where: { ...T, createdAt: { gte: dayAgo } } }),
      this.prisma.user.count({ where: { ...T, createdAt: { gte: weekAgo } } }),
      this.prisma.device.count({ where: tenantId ? { user: { tenantId } } : {} }),
      this.prisma.node.count({ where: tenantId ? { tenantId } : {} }),
      this.prisma.node.count({ where: { ...(tenantId ? { tenantId } : {}), online: true } }),
      this.prisma.user.count({ where: { ...T, devices: { some: {} } } }),              // «получили доступ»
      this.prisma.user.count({ where: { ...T, expireAt: { gte: monthAgo, lt: now } } }), // истекли за месяц (отток)
    ]);

    const revBetween = async (since?: Date, until?: Date) => {
      const r = await this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { ...T, status: 'paid', ...(since || until ? { paidAt: { ...(since ? { gte: since } : {}), ...(until ? { lt: until } : {}) } } : {}) },
      });
      return Number(r._sum.amount || 0);
    };
    const [revDay, revWeek, revMonth, revTotal, revPrevMonth] = await Promise.all([
      revBetween(dayAgo), revBetween(weekAgo), revBetween(monthAgo), revBetween(), revBetween(twoMonthAgo, monthAgo),
    ]);

    // уникальные плательщики (для LTV и воронки «оплатили»)
    const payers = await this.prisma.payment.groupBy({ by: ['userId'], where: { ...T, status: 'paid' } });
    const payingUsers = payers.length;

    // здоровье бизнеса
    const arpu = active ? Math.round(revMonth / active) : 0;                 // доход с активного клиента/мес
    const ltv = payingUsers ? Math.round(revTotal / payingUsers) : 0;       // сколько принёс 1 плательщик всего
    const churnBase = active + expiredMonth;
    const churnPct = churnBase ? +(expiredMonth / churnBase * 100).toFixed(1) : 0;
    const momPct = revPrevMonth ? Math.round((revMonth - revPrevMonth) / revPrevMonth * 100) : (revMonth ? 100 : 0);

    // график: доход и регистрации по дням за 30 дней
    const days = 30;
    const since = new Date(now.getTime() - days * 86400_000);
    const [revByDay, signByDay] = await Promise.all([
      this.prisma.payment.findMany({ where: { ...T, status: 'paid', paidAt: { gte: since } }, select: { amount: true, paidAt: true } }),
      this.prisma.user.findMany({ where: { ...T, createdAt: { gte: since } }, select: { createdAt: true } }),
    ]);
    const chart: { date: string; revenue: number; signups: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(now.getTime() - i * 86400_000).toISOString().slice(0, 10);
      const revenue = revByDay.filter((p) => p.paidAt && p.paidAt.toISOString().slice(0, 10) === key).reduce((s, p) => s + Number(p.amount), 0);
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
      health: { revenueMonth: revMonth, revenuePrevMonth: revPrevMonth, momPct, active, churnPct, arpu, ltv, payingUsers },
      funnel: { entered: total, access: withDevice, paid: payingUsers },
      chart,
      recent: recent.map((p) => ({
        amount: Number(p.amount), method: p.method, topup: p.topup,
        name: p.user?.tgName || p.user?.tgUsername || '—', paidAt: p.paidAt,
      })),
    };
  }
}
