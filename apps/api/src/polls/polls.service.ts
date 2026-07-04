import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/**
 * Опросы/конкурсы: админ создаёт опрос с вариантами и наградой (дни). Клиент
 * голосует в боте ОДИН раз (unique pollId+userId) и получает награду. Итоги —
 * счётчики голосов по вариантам в панели.
 */
@Injectable()
export class PollsService {
  constructor(private prisma: PrismaService, private users: UsersService) {}

  async create(dto: any) {
    const question = String(dto?.question || '').trim();
    if (!question) throw new BadRequestException('нужен вопрос');
    const options = (Array.isArray(dto?.options) ? dto.options : []).map((s: any) => String(s || '').trim()).filter(Boolean);
    if (options.length < 2) throw new BadRequestException('нужно минимум 2 варианта');
    const rewardDays = Math.max(0, Math.round(Number(dto?.rewardDays) || 0));
    return this.prisma.poll.create({
      data: {
        question, rewardDays, tenantId: dto?.tenantId || null,
        options: { create: options.map((text: string, i: number) => ({ text, order: i })) },
      },
      include: { options: true },
    });
  }

  async list() {
    return this.prisma.poll.findMany({
      orderBy: { createdAt: 'desc' },
      include: { options: { orderBy: { order: 'asc' } }, _count: { select: { votes: true } } },
    });
  }

  /** Активные опросы + флаг «уже голосовал» — для бота. */
  async activeForUser(userId: string) {
    const polls = await this.prisma.poll.findMany({
      where: { isActive: true }, orderBy: { createdAt: 'desc' },
      include: { options: { orderBy: { order: 'asc' } } },
    });
    const voted = new Set((await this.prisma.pollVote.findMany({ where: { userId }, select: { pollId: true } })).map((v) => v.pollId));
    return polls.map((p) => ({ ...p, voted: voted.has(p.id) }));
  }

  async setActive(id: string, isActive: boolean) { return this.prisma.poll.update({ where: { id }, data: { isActive } }); }
  async remove(id: string) { await this.prisma.poll.delete({ where: { id } }); return { ok: true }; }

  /** Голос клиента: один раз на опрос (unique), +reward дней. */
  async vote(userId: string, optionId: string) {
    const opt = await this.prisma.pollOption.findUnique({ where: { id: optionId }, include: { poll: true } });
    if (!opt) throw new BadRequestException('вариант не найден');
    if (!opt.poll.isActive) throw new BadRequestException('опрос завершён');
    try {
      await this.prisma.pollVote.create({ data: { pollId: opt.pollId, userId, optionId } });
    } catch { throw new BadRequestException('вы уже голосовали в этом опросе'); }
    await this.prisma.pollOption.update({ where: { id: optionId }, data: { votes: { increment: 1 } } });
    let message = 'Голос учтён!';
    if (opt.poll.rewardDays > 0) { await this.users.grantDays(userId, opt.poll.rewardDays); message = `Голос учтён! +${opt.poll.rewardDays} дн. подписки 🎁`; }
    return { ok: true, message };
  }
}
