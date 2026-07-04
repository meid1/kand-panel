import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/**
 * Реферальная программа (базовый минимум, работает и для франшиз — привязка идёт
 * в рамках тенанта). У каждого клиента свой код и реф-ссылка на бота. Когда
 * приглашённый ВПЕРВЫЕ оплачивает — пригласившему начисляются бонус-дни
 * (referral.reward_days), приглашённому — referral.referee_days. Награда за
 * первую оплату — один раз (refFirstPay), защита от накрутки.
 */
@Injectable()
export class ReferralService {
  private readonly log = new Logger(ReferralService.name);
  constructor(private prisma: PrismaService, private users: UsersService) {}

  private async setting(key: string, def: number): Promise<number> {
    const s = await this.prisma.setting.findUnique({ where: { key } });
    return s ? (Number(s.value) || 0) : def;
  }

  private gen(): string {
    return randomBytes(5).toString('hex'); // 10 симв, достаточно уникально
  }

  /** Гарантирует, что у клиента есть реф-код (создаёт при первом обращении). */
  async ensureCode(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) return '';
    if (u.referralCode) return u.referralCode;
    // уникальность
    for (let i = 0; i < 5; i++) {
      const code = this.gen();
      if (!(await this.prisma.user.findUnique({ where: { referralCode: code } }))) {
        await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
        return code;
      }
    }
    return u.id.slice(0, 10);
  }

  /** Привязать пригласившего по коду (один раз, не сам себя, тот же тенант). */
  async link(userId: string, code: string): Promise<boolean> {
    if (!code) return false;
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || u.referrerId) return false; // уже привязан
    const ref = await this.prisma.user.findUnique({ where: { referralCode: code } });
    if (!ref || ref.id === userId || ref.tenantId !== u.tenantId) return false;
    await this.prisma.user.update({ where: { id: userId }, data: { referrerId: ref.id } });
    // бонус приглашённому за приход по ссылке (если задан)
    const refereeDays = await this.setting('referral.referee_days', 0);
    if (refereeDays > 0) await this.users.grantDays(userId, refereeDays);
    return true;
  }

  /** Награда пригласившему при ПЕРВОЙ оплате приглашённого (идемпотентно). */
  async rewardOnFirstPayment(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || u.refFirstPay || !u.referrerId) return;
    // АТОМАРНАЯ пометка: только один параллельный вебхук выиграет гонку и начислит бонус.
    const claim = await this.prisma.user.updateMany({
      where: { id: userId, refFirstPay: false }, data: { refFirstPay: true },
    });
    if (claim.count === 0) return; // уже награждён другим запросом
    const rewardDays = await this.setting('referral.reward_days', 0);
    if (rewardDays > 0) {
      await this.users.grantDays(u.referrerId, rewardDays);
      await this.prisma.user.update({
        where: { id: u.referrerId }, data: { refEarnedDays: { increment: rewardDays } },
      });
      this.log.log(`реферал: ${u.referrerId} +${rewardDays} дн. за оплату ${userId}`);
    }
  }

  /** Ссылка + статистика для клиента (бот/кабинет). */
  async stats(userId: string) {
    const code = await this.ensureCode(userId);
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    const invited = await this.prisma.user.count({ where: { referrerId: userId } });
    const paid = await this.prisma.user.count({ where: { referrerId: userId, refFirstPay: true } });
    const botUser = (await this.prisma.setting.findUnique({ where: { key: 'bot.username' } }))?.value;
    const link = botUser ? `https://t.me/${botUser}?start=ref_${code}` : `ref_${code}`;
    return { code, link, invited, paid, earnedDays: u?.refEarnedDays || 0 };
  }
}
