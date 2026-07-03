import { Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { BypassService } from '../bypass/bypass.service';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Клиентский веб-кабинет. Доступ — по личной ссылке /cabinet/<subToken> (токен =
 * непубличный ключ устройства, его же клиент получает в боте). Никакого пароля.
 * Показывает: срок подписки, остаток обхода, устройства с ссылками, продление.
 * Бренд/акцент — из настроек (без хардкода, без проприетарного приложения).
 */
@Injectable()
export class CabinetService {
  constructor(
    private prisma: PrismaService,
    private bypass: BypassService,
    private payments: PaymentsService,
    private settings: SettingsService,
  ) {}

  private async resolve(token: string) {
    const device = await this.prisma.device.findUnique({
      where: { subToken: token }, include: { user: true },
    });
    if (!device) throw new NotFoundException('кабинет не найден');
    return device.user;
  }

  private base(): string { return (process.env.PANEL_URL || '').replace(/\/$/, ''); }

  /** Данные кабинета для клиента (по токену). */
  async data(token: string) {
    const user = await this.resolve(token);
    const brand = await this.settings.brand();
    const accent = (await this.prisma.setting.findUnique({ where: { key: 'brand.color' } }))?.value || '#00d4ff';
    const bp = await this.bypass.state(user.id);
    const devices = await this.prisma.device.findMany({
      where: { userId: user.id }, orderBy: { createdAt: 'asc' },
    });
    const methods = await this.payments.available();
    const now = Date.now();
    const active = !user.isBlocked && (!user.expireAt || user.expireAt.getTime() > now);
    return {
      brand, accent,
      active,
      expireAt: user.expireAt,
      daysLeft: user.expireAt ? Math.max(0, Math.ceil((user.expireAt.getTime() - now) / 86400000)) : null,
      bypass: bp,
      devices: devices.map((d) => ({
        name: d.name,
        sub: `${this.base()}/sub/${d.subToken}`,
        smart: `${this.base()}/sub/${d.subToken}/xray`,
        tv: d.tvCode ? `${this.base()}/t/${d.tvCode}` : null, // короткая ссылка для ТВ
        tvCode: d.tvCode,
      })),
      payMethods: methods,
    };
  }

  /** QR-код (SVG) умной ссылки устройства — для сканирования в приложение. */
  async qr(token: string, idx: number): Promise<string> {
    const user = await this.resolve(token);
    const devices = await this.prisma.device.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    const d = devices[idx] || devices[0];
    if (!d) throw new NotFoundException('устройство не найдено');
    const link = `${this.base()}/sub/${d.subToken}/xray`;
    return QRCode.toString(link, { type: 'svg', margin: 1, color: { dark: '#0b1220', light: '#ffffff' } });
  }

  /** Создать счёт на продление (клиент выбрал платёжку). */
  async buy(token: string, provider: string) {
    const user = await this.resolve(token);
    const daysS = await this.prisma.setting.findUnique({ where: { key: 'plan.days' } });
    const priceS = await this.prisma.setting.findUnique({ where: { key: 'plan.price' } });
    const days = daysS ? Number(daysS.value) || 30 : 30;
    const amount = priceS ? Number(priceS.value) || 90 : 90;
    return this.payments.createInvoice({
      userId: user.id, provider, amount, days,
      returnUrl: `${this.base()}/cabinet/${token}`,
    } as any);
  }
}
