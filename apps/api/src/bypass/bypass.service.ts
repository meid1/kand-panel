import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BridgeService } from '../bridge/bridge.service';

const GB = 1024n * 1024n * 1024n;
const PERIOD_MS = 30 * 24 * 3600 * 1000;

/**
 * Обход белых списков с лимитом ГБ. Трафик через VPN считает StatsService
 * (BypassUsage.totalBytes). Здесь — лимит, проверка исчерпания, докупка/списание.
 *
 * Лимит опционален: если ни capManualGb, ни capGb, ни bypass.default_cap_gb не заданы —
 * обход БЕЗЛИМИТНЫЙ (по умолчанию так, лимитирование включается осознанно).
 * При исчерпании isSuspended=true → reconcile убирает ключи с нод (реальный стоп),
 * а подписка показывает «лимит закончился, докупить в {support}».
 */
@Injectable()
export class BypassService {
  private readonly log = new Logger(BypassService.name);
  constructor(private prisma: PrismaService, private bridge: BridgeService) {}

  /** email клиента во внешнем бэкенде = externalId (для моста). */
  private async extEmail(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { externalId: true } });
    return u?.externalId || null;
  }

  private async defaultCapGb(): Promise<number> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'bypass.default_cap_gb' } });
    return s ? Number(s.value) || 0 : 0;
  }

  /** База лимита в ГБ (ручной перебивает тарифный, иначе дефолт). 0 = безлимит. */
  private baseCapGb(u: { capManualGb: number | null; capGb: number | null }, def: number): number {
    if (u.capManualGb != null) return u.capManualGb;
    if (u.capGb != null) return u.capGb;
    return def;
  }

  /** Состояние обхода клиента (для UI/подписки). */
  async state(userId: string) {
    const u = await this.prisma.bypassUsage.findUnique({ where: { userId } });
    const def = await this.defaultCapGb();
    if (!u) return { unlimited: def === 0, capGb: def, usedGb: 0, remainingGb: def, suspended: false };
    const baseGb = this.baseCapGb(u, def);
    const allowance = BigInt(baseGb) * GB + u.purchasedBytes + u.giftBytes;
    const used = u.totalBytes - u.baselineBytes;
    const usedGb = Number(used < 0n ? 0n : used) / Number(GB);
    if (baseGb === 0 && u.purchasedBytes === 0n && u.giftBytes === 0n) {
      return { unlimited: true, capGb: 0, usedGb, remainingGb: null, suspended: false };
    }
    const remaining = allowance - (used < 0n ? 0n : used);
    return {
      unlimited: false,
      capGb: Number(allowance) / Number(GB),
      usedGb,
      remainingGb: Number(remaining) / Number(GB),
      suspended: u.isSuspended,
    };
  }

  /** Пересчёт статусов всех клиентов с лимитом + месячный сброс. Зовём после сбора трафика. */
  async checkAll() {
    const def = await this.defaultCapGb();
    const all = await this.prisma.bypassUsage.findMany();
    const now = Date.now();
    for (const u of all) {
      // месячный сброс периода
      if (now - u.periodStart.getTime() > PERIOD_MS) {
        await this.prisma.bypassUsage.update({
          where: { userId: u.userId },
          data: { baselineBytes: u.totalBytes, periodStart: new Date(now), isSuspended: false },
        });
        continue;
      }
      const baseGb = this.baseCapGb(u, def);
      if (baseGb === 0 && u.purchasedBytes === 0n && u.giftBytes === 0n) {
        if (u.isSuspended) await this.setSuspended(u.userId, false); // стал безлимитным
        continue;
      }
      const allowance = BigInt(baseGb) * GB + u.purchasedBytes + u.giftBytes;
      const used = u.totalBytes - u.baselineBytes;
      const suspend = used >= allowance;
      if (suspend !== u.isSuspended) await this.setSuspended(u.userId, suspend);
    }
  }

  private async setSuspended(userId: string, v: boolean) {
    await this.prisma.bypassUsage.update({ where: { userId }, data: { isSuspended: v } });
  }

  private async ensure(userId: string) {
    return this.prisma.bypassUsage.upsert({
      where: { userId }, update: {}, create: { userId },
    });
  }

  /** Докупить ГБ обхода (увеличивает остаток, снимает блокировку если хватило). */
  async addGb(userId: string, gb: number) {
    await this.ensure(userId);
    await this.prisma.bypassUsage.update({
      where: { userId }, data: { purchasedBytes: { increment: BigInt(Math.round(gb)) * GB } },
    });
    await this.reevaluate(userId);
    const em = await this.extEmail(userId);
    if (em) await this.bridge.adjustBypassGb(em, gb); // проброс в живой бэкенд
    return this.state(userId);
  }

  /** Списать ГБ обхода (уменьшает остаток; БЕЗ уведомления клиента — по требованию владельца). */
  async deductGb(userId: string, gb: number) {
    await this.ensure(userId);
    await this.prisma.bypassUsage.update({
      where: { userId }, data: { purchasedBytes: { decrement: BigInt(Math.round(gb)) * GB } },
    });
    await this.reevaluate(userId);
    const em = await this.extEmail(userId);
    if (em) await this.bridge.adjustBypassGb(em, -gb); // проброс в живой бэкенд
    return this.state(userId);
  }

  private async reevaluate(userId: string) {
    const u = await this.prisma.bypassUsage.findUnique({ where: { userId } });
    if (!u) return;
    const def = await this.defaultCapGb();
    const baseGb = this.baseCapGb(u, def);
    if (baseGb === 0 && u.purchasedBytes === 0n && u.giftBytes === 0n) {
      if (u.isSuspended) await this.setSuspended(userId, false);
      return;
    }
    const allowance = BigInt(baseGb) * GB + u.purchasedBytes + u.giftBytes;
    const used = u.totalBytes - u.baselineBytes;
    await this.setSuspended(userId, used >= allowance);
  }

  /**
   * СБРОС счётчика обхода клиента (если импорт/учёт разошёлся). Обнуляет
   * использованный трафик (used=0), снимает блокировку, начинает период заново.
   * Лимит (capGb/докупки) НЕ трогает.
   */
  async reset(userId: string) {
    await this.ensure(userId);
    await this.prisma.bypassUsage.update({
      where: { userId },
      data: { baselineBytes: 0n, totalBytes: 0n, isSuspended: false, periodStart: new Date() },
    });
    const em = await this.extEmail(userId);
    if (em) await this.bridge.resetTraffic(em); // сброс счётчика и в живом бэкенде
    return this.state(userId);
  }

  /** Сброс счётчиков у ВСЕХ (аккуратно — для массового исправления после импорта). */
  async resetAll() {
    const r = await this.prisma.bypassUsage.updateMany({
      data: { baselineBytes: 0n, totalBytes: 0n, isSuspended: false },
    });
    return { ok: true, reset: r.count };
  }

  /** Тумблер «С обходом / Без обхода»: has_bypass в живом бэкенде. */
  async setBypassFlag(userId: string, on: boolean) {
    const em = await this.extEmail(userId);
    if (em) await this.bridge.setHasBypass(em, on);
    return { ok: true, hasBypass: on };
  }

  /** Быстрый флаг для подписки/реконсайла. */
  async isSuspended(userId: string): Promise<boolean> {
    const u = await this.prisma.bypassUsage.findUnique({ where: { userId } });
    return !!u?.isSuspended;
  }
}
