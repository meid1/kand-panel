import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Финансы: доход (paid-платежи) по способам и месяцам + ручной учёт расходов/
 * внешних доходов (LedgerEntry). Прибыль = доход + внешние доходы − расходы.
 * Оплата с баланса не пишется в Payment → авто не задваивает доход.
 */
@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async summary(tenantId?: string) {
    const T: any = tenantId ? { tenantId } : {};
    const paid = { ...T, status: 'paid' };

    // доход по способам оплаты
    const byMethodRaw = await this.prisma.payment.groupBy({
      by: ['method'], where: paid, _sum: { amount: true }, _count: { _all: true },
    });
    const byMethod = byMethodRaw
      .map((m) => ({ method: m.method, amount: Number(m._sum.amount || 0), count: m._count._all }))
      .sort((a, b) => b.amount - a.amount);

    // доход по месяцам (6 мес)
    const since = new Date(Date.now() - 183 * 86400_000);
    const pays = await this.prisma.payment.findMany({
      where: { ...paid, paidAt: { gte: since } }, select: { amount: true, paidAt: true },
    });
    const byMonthMap = new Map<string, number>();
    for (const p of pays) {
      if (!p.paidAt) continue;
      const k = p.paidAt.toISOString().slice(0, 7);
      byMonthMap.set(k, (byMonthMap.get(k) || 0) + Number(p.amount));
    }
    const byMonth = [...byMonthMap.entries()].sort().map(([month, amount]) => ({ month, amount }));

    const revenueTotal = byMethod.reduce((s, m) => s + m.amount, 0);
    const [exp, inc] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { ...T, kind: 'expense' } }),
      this.prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { ...T, kind: 'income' } }),
    ]);
    const expenses = Number(exp._sum.amount || 0);
    const extraIncome = Number(inc._sum.amount || 0);

    return {
      revenueTotal, expenses, extraIncome,
      profit: revenueTotal + extraIncome - expenses,
      byMethod, byMonth,
    };
  }

  listLedger(tenantId?: string) {
    return this.prisma.ledgerEntry.findMany({
      where: tenantId ? { tenantId } : {}, orderBy: { createdAt: 'desc' }, take: 100,
    });
  }

  async addLedger(kind: string, amount: number, note?: string, tenantId?: string) {
    if (kind !== 'expense' && kind !== 'income') throw new BadRequestException('kind: expense | income');
    if (!amount || amount <= 0) throw new BadRequestException('сумма должна быть > 0');
    return this.prisma.ledgerEntry.create({
      data: { kind, amount, note: note || null, tenantId: tenantId || null },
    });
  }

  async removeLedger(id: string) {
    await this.prisma.ledgerEntry.deleteMany({ where: { id } });
    return { ok: true };
  }
}
