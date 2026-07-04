import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { tg } from '../bot/telegram';

/**
 * Тикеты поддержки: клиент создаёт обращение (из бота/кабинета), админ отвечает
 * из панели. Ответ админа доставляется клиенту в Telegram (если задан bot.token).
 */
@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService) {}

  /** Клиент открывает тикет (первое сообщение). */
  async open(userId: string, subject: string, text: string, tenantId?: string) {
    if (!text?.trim()) throw new BadRequestException('пустое сообщение');
    return this.prisma.ticket.create({
      data: {
        userId, tenantId: tenantId || null, subject: (subject || 'Обращение').slice(0, 120),
        status: 'open',
        messages: { create: { fromAdmin: false, text: text.trim().slice(0, 4000) } },
      },
    });
  }

  /** Список тикетов для панели (фильтр по статусу). */
  async list(status?: string, tenantId?: string) {
    return this.prisma.ticket.findMany({
      where: { ...(status ? { status } : {}), ...(tenantId ? { tenantId } : {}) },
      orderBy: { updatedAt: 'desc' }, take: 200,
      include: {
        user: { select: { tgId: true, tgName: true, tgUsername: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 1 },
        _count: { select: { messages: true } },
      },
    });
  }

  async one(id: string) {
    const t = await this.prisma.ticket.findUnique({
      where: { id },
      include: { user: { select: { tgId: true, tgName: true, tgUsername: true } }, messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!t) throw new NotFoundException('тикет не найден');
    return t;
  }

  /** Ответ админа: сохраняем + шлём клиенту в Telegram. */
  async reply(id: string, text: string) {
    if (!text?.trim()) throw new BadRequestException('пустой ответ');
    const t = await this.prisma.ticket.findUnique({ where: { id }, include: { user: { select: { tgId: true } } } });
    if (!t) throw new NotFoundException('тикет не найден');
    await this.prisma.ticketMessage.create({ data: { ticketId: id, fromAdmin: true, text: text.trim().slice(0, 4000) } });
    await this.prisma.ticket.update({ where: { id }, data: { status: 'answered' } });
    // доставка ответа клиенту
    const token = (await this.prisma.setting.findUnique({ where: { key: 'bot.token' } }))?.value;
    if (token && t.user?.tgId) {
      await tg.sendMessage(token, Number(t.user.tgId), `💬 <b>Ответ поддержки</b>\n\n${this.esc(text.trim())}`).catch(() => {});
    }
    return { ok: true };
  }

  async setStatus(id: string, status: string) {
    if (!['open', 'answered', 'closed'].includes(status)) throw new BadRequestException('статус: open|answered|closed');
    return this.prisma.ticket.update({ where: { id }, data: { status } });
  }

  /** Число открытых (для бейджа в панели). */
  async openCount(tenantId?: string) {
    const n = await this.prisma.ticket.count({ where: { status: { in: ['open'] }, ...(tenantId ? { tenantId } : {}) } });
    return { open: n };
  }

  private esc(s: string) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string)); }
}
