import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Вывод реф-средств ДЕНЬГАМИ. Клиент копит refEarnedMoney (начисляется в
 * ReferralService за оплаты приглашённых), запрашивает вывод с реквизитами —
 * средства атомарно списываются с реф-баланса (холд), админ выплачивает
 * (paid) или отклоняет (rejected → деньги возвращаются на реф-баланс).
 */
@Injectable()
export class WithdrawalsService {
  private readonly log = new Logger(WithdrawalsService.name);
  constructor(private prisma: PrismaService) {}

  /** Заявка от клиента: списываем с реф-баланса атомарно, создаём pending. */
  async request(userId: string, amount: number, requisites: string) {
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new BadRequestException('сумма должна быть больше 0');
    if (!requisites || !requisites.trim()) throw new BadRequestException('нужны реквизиты для выплаты');
    // атомарное списание — не уйдёт в минус при гонке
    const dec = await this.prisma.user.updateMany({
      where: { id: userId, refEarnedMoney: { gte: amt } }, data: { refEarnedMoney: { decrement: amt } },
    });
    if (dec.count === 0) throw new BadRequestException('недостаточно средств на реф-балансе');
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    const w = await this.prisma.withdrawal.create({
      data: { tenantId: u?.tenantId ?? null, userId, amount: amt, requisites: requisites.trim(), status: 'pending' },
    });
    this.log.log(`заявка на вывод: ${userId} ${amt}₽`);
    return w;
  }

  async list(status?: string) {
    return this.prisma.withdrawal.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { user: { select: { tgName: true, tgUsername: true, tgId: true } } },
    });
  }

  async pendingCount() { return this.prisma.withdrawal.count({ where: { status: 'pending' } }); }

  /** Админ: выплатить (paid) или отклонить (rejected — вернуть деньги на реф-баланс). */
  async setStatus(id: string, status: string, note?: string) {
    if (!['paid', 'rejected'].includes(status)) throw new BadRequestException('status: paid | rejected');
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('заявка не найдена');
    if (w.status !== 'pending') throw new BadRequestException('заявка уже обработана');
    if (status === 'rejected') {
      await this.prisma.user.update({ where: { id: w.userId }, data: { refEarnedMoney: { increment: w.amount } } });
    }
    return this.prisma.withdrawal.update({ where: { id }, data: { status, note: note || null, processedAt: new Date() } });
  }
}
