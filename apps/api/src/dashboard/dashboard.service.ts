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
      // «получили доступ» = завели ключ (устройство в Kand) ИЛИ есть подписка (expireAt задан).
      // В гибриде устройства живут во внешнем cdn_api, поэтому по одному Device выходило меньше,
      // чем «оплатили» — а оплативший всегда получал доступ. Учитываем и подписку.
      this.prisma.user.count({ where: { ...T, OR: [{ devices: { some: {} } }, { expireAt: { not: null } }] } }),
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

    // уникальные плательщики: всего (LTV/воронка) и за 30 дн (ARPPU)
    const [payersAll, payersMonth, activePayers, churnedPayers] = await Promise.all([
      this.prisma.payment.groupBy({ by: ['userId'], where: { ...T, status: 'paid' } }),
      this.prisma.payment.groupBy({ by: ['userId'], where: { ...T, status: 'paid', paidAt: { gte: monthAgo } } }),
      // активные платящие (для базы оттока — считаем ТОЛЬКО тех, кто реально платил)
      this.prisma.user.count({ where: { ...T, isBlocked: false, expireAt: { gt: now }, payments: { some: { status: 'paid' } } } }),
      // ушли за 30 дн: платившие, у кого подписка кончилась в окне и НЕ активна
      this.prisma.user.count({ where: { ...T, expireAt: { gte: monthAgo, lt: now }, payments: { some: { status: 'paid' } } } }),
    ]);
    const payingUsers = payersAll.length;         // всего платящих (за всё время)
    const payingUsersMonth = payersMonth.length;  // платящих за 30 дн

    // здоровье бизнеса
    const arppu = payingUsersMonth ? Math.round(revMonth / payingUsersMonth) : 0; // выручка/30дн ÷ платящих за 30дн
    const ltv = payingUsers ? Math.round(revTotal / payingUsers) : 0;            // вся выручка ÷ всех платящих
    const churnBase = activePayers + churnedPayers;
    const churnPct = churnBase ? +(churnedPayers / churnBase * 100).toFixed(1) : 0;
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

    // прогноз дохода: история по месяцам (6 мес) + оценка следующего месяца
    const paysM = await this.prisma.payment.findMany({
      where: { ...T, status: 'paid', paidAt: { gte: new Date(now.getTime() - 190 * 86400_000) } },
      select: { amount: true, paidAt: true },
    });
    const monthMap = new Map<string, number>();
    for (const p of paysM) { if (!p.paidAt) continue; const k = p.paidAt.toISOString().slice(0, 7); monthMap.set(k, (monthMap.get(k) || 0) + Number(p.amount)); }
    const byMonth = [...monthMap.entries()].sort().map(([month, amount]) => ({ month, amount }));
    const trend = revPrevMonth ? Math.max(0.7, Math.min(1.4, revMonth / revPrevMonth)) : 1;
    const fNext = Math.round(revMonth * trend);
    const forecast = { next: fNext, low: Math.round(fNext * 0.82), high: Math.round(fNext * 1.18), byMonth };

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
      health: { revenueMonth: revMonth, revenuePrevMonth: revPrevMonth, momPct, active,
        activePayers, churnedPayers, churnPct, arppu, ltv, payingUsers, payingUsersMonth },
      funnel: { entered: total, access: withDevice, paid: payingUsers },
      forecast,
      chart,
      recent: recent.map((p) => ({
        amount: Number(p.amount), method: p.method, topup: p.topup,
        name: p.user?.tgName || p.user?.tgUsername || '—', paidAt: p.paidAt,
      })),
    };
  }
}
