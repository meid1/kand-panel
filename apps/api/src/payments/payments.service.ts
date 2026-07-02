import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ProviderRegistry } from './providers/provider.registry';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

/**
 * Оркестрация оплаты поверх реестра провайдеров. Единый путь:
 * создать Payment(pending) → счёт у провайдера → вернуть ссылку. Вебхук →
 * проверка подписи (в провайдере) → начисление дней. Всё идемпотентно:
 * повторный вебхук по уже оплаченному Payment ничего не делает второй раз.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  constructor(
    private prisma: PrismaService,
    private registry: ProviderRegistry,
    private users: UsersService,
  ) {}

  async createInvoice(dto: CreateInvoiceDto) {
    const provider = this.registry.get(dto.provider);
    if (!provider) throw new BadRequestException('неизвестный провайдер');
    if (!(await this.registry.isEnabled(dto.provider)))
      throw new BadRequestException('провайдер выключен');
    const cfg = await this.registry.configFor(dto.provider);

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('пользователь не найден');

    const payment = await this.prisma.payment.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        amount: dto.amount,
        method: dto.provider,
        days: dto.days,
        status: 'pending',
        description: dto.description,
      },
    });

    try {
      const inv = await provider.createInvoice(
        {
          paymentId: payment.id,
          amount: dto.amount,
          currency: dto.currency || 'RUB',
          description: dto.description || `Подписка ${dto.days} дн.`,
          returnUrl: dto.returnUrl,
        },
        cfg,
      );
      await this.prisma.payment.update({
        where: { id: payment.id }, data: { invoiceId: inv.externalId },
      });
      return { paymentId: payment.id, url: inv.url };
    } catch (e: any) {
      await this.prisma.payment.update({
        where: { id: payment.id }, data: { status: 'failed' },
      });
      throw new BadRequestException(`создание счёта не удалось: ${e.message || e}`);
    }
  }

  /** Обработка вебхука провайдера. rawBody — точные байты (для подписи). */
  async handleWebhook(providerId: string, headers: Record<string, any>, rawBody: string) {
    const provider = this.registry.get(providerId);
    if (!provider) throw new NotFoundException('неизвестный провайдер');
    const cfg = await this.registry.configFor(providerId);

    const res = await provider.handleWebhook(headers, rawBody, cfg); // бросит при плохой подписи

    // ищем наш Payment: сначала по возвращённому paymentId, иначе по invoiceId
    let payment = res.paymentId
      ? await this.prisma.payment.findUnique({ where: { id: res.paymentId } })
      : null;
    if (!payment && res.externalId)
      payment = await this.prisma.payment.findFirst({ where: { invoiceId: res.externalId } });
    if (!payment) return { ok: true, note: 'платёж не найден (игнор)' };

    if (payment.status === 'paid') return { ok: true, note: 'уже оплачен' }; // идемпотентность

    if (res.status === 'paid') {
      await this.prisma.payment.update({
        where: { id: payment.id }, data: { status: 'paid', paidAt: new Date() },
      });
      if (payment.days) await this.users.grantDays(payment.userId, payment.days);
      this.log.log(`оплата ${payment.id} (${providerId}) → +${payment.days} дн.`);
      return { ok: true, granted: payment.days };
    }
    if (res.status === 'failed') {
      await this.prisma.payment.update({
        where: { id: payment.id }, data: { status: 'failed' },
      });
    }
    return { ok: true };
  }

  async list(tenantId?: string) {
    return this.prisma.payment.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' }, take: 200,
    });
  }

  /** Способы оплаты для клиента (только включённые). */
  async available() {
    const en = await this.registry.enabled();
    return en.map((p) => ({ id: p.id, title: p.title, kinds: p.kinds }));
  }

  /** Все провайдеры + статус вкл/выкл + нужные поля — для админки. */
  async adminList() {
    const out = [];
    for (const p of this.registry.all()) {
      out.push({
        id: p.id, title: p.title, kinds: p.kinds,
        requiredKeys: p.requiredKeys, enabled: await this.registry.isEnabled(p.id),
      });
    }
    return out;
  }
}
