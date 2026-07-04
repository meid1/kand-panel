import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * UTM-кампании: воронка переход(клик)→регистрация→оплата по метке code.
 * Ссылка panel/c/<code> считает клик и ведёт в бота (?start=c_<code>);
 * бот на первом /start привязывает клиента к кампании; оплаты считаем по
 * клиентам этой кампании. Регистрация/оплата атрибутируются точно (по campaignId).
 */
@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  private norm(code: string) { return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''); }

  async botUsername(): Promise<string | null> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'bot.username' } });
    return s?.value || null;
  }

  async create(dto: any) {
    const name = String(dto?.name || '').trim();
    if (!name) throw new BadRequestException('нужно название');
    const code = this.norm(dto?.code) || this.norm(name).slice(0, 12);
    if (!code) throw new BadRequestException('нужен код кампании (латиница/цифры)');
    if (await this.prisma.campaign.findUnique({ where: { code } })) throw new BadRequestException('такой код уже есть');
    return this.prisma.campaign.create({ data: { name, code, tenantId: dto?.tenantId || null } });
  }

  async list() {
    const campaigns = await this.prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
    const username = await this.botUsername();
    const out: any[] = [];
    for (const c of campaigns) {
      const users = await this.prisma.user.findMany({ where: { campaignId: c.id }, select: { id: true } });
      const ids = users.map((u) => u.id);
      let paid = 0, revenue = 0;
      if (ids.length) {
        const pays = await this.prisma.payment.findMany({ where: { userId: { in: ids }, status: 'paid' }, select: { userId: true, amount: true } });
        const payers = new Set(pays.map((p) => p.userId));
        paid = payers.size;
        revenue = pays.reduce((s, p) => s + Number(p.amount), 0);
      }
      out.push({ ...c, regs: ids.length, paid, revenue, link: username ? `https://t.me/${username}?start=c_${c.code}` : null });
    }
    return { botUsername: username, campaigns: out };
  }

  async remove(id: string) {
    await this.prisma.user.updateMany({ where: { campaignId: id }, data: { campaignId: null } });
    await this.prisma.campaign.delete({ where: { id } });
    return { ok: true };
  }

  /** Клик по ссылке /c/:code → +1 клик; вернуть deep-link в бота (или null). */
  async trackClick(codeRaw: string): Promise<string | null> {
    const code = this.norm(codeRaw);
    if (!code) return null;
    const c = await this.prisma.campaign.findUnique({ where: { code } });
    if (!c) return null;
    await this.prisma.campaign.update({ where: { id: c.id }, data: { clicks: { increment: 1 } } });
    const username = await this.botUsername();
    return username ? `https://t.me/${username}?start=c_${c.code}` : null;
  }

  /** Привязать кампанию к клиенту (первый /start c_<code>, только если ещё не привязан). */
  async attribute(userId: string, codeRaw: string) {
    const code = this.norm(codeRaw);
    if (!code) return;
    const c = await this.prisma.campaign.findUnique({ where: { code } });
    if (!c) return;
    await this.prisma.user.updateMany({ where: { id: userId, campaignId: null }, data: { campaignId: c.id } });
  }
}
