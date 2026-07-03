import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BypassService } from '../bypass/bypass.service';

/**
 * Генерация клиентской подписки по sub-токену устройства. Отдаёт base64-список
 * vless:// / hy2:// ссылок по всем нодам тенанта (showInSub, активные), с
 * Reality-параметрами. Бренд берётся из тенанта — НИКАКОГО хардкода бренда.
 */
@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService, private bypass: BypassService) {}

  private enc(s: string) { return encodeURIComponent(s); }

  private async support(): Promise<string> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'support' } });
    return s?.value || '@marius_support';
  }

  /** Кастомная маршрутизация (админ добавляет свои сайты): {direct[],block[],proxy[]}. */
  private async customRouting(): Promise<{ direct: string[]; block: string[]; proxy: string[] }> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'routing.custom' } });
    let raw: any = {}; try { raw = s ? JSON.parse(s.value) : {}; } catch { raw = {}; }
    const norm = (arr: any) => (Array.isArray(arr) ? arr : String(arr || '').split(/[\s,]+/))
      .map((d: string) => String(d).trim()).filter(Boolean)
      .map((d: string) => (d.includes(':') ? d : `domain:${d}`)); // domain:example.com
    return { direct: norm(raw.direct), block: norm(raw.block), proxy: norm(raw.proxy) };
  }

  /** Ссылка одного инбаунда ноды для устройства. */
  private link(node: any, inbound: any, uuid: string, brand: string): string | null {
    const tag = `${brand} · ${node.label}`;
    const host = node.address;
    if (inbound.protocol === 'hysteria2') {
      // hy2://uuid@host:port?sni=...#tag  (пароль = uuid)
      return `hy2://${uuid}@${host}:${inbound.port}?sni=${this.enc(node.sni || '')}` +
        `&insecure=0#${this.enc(tag)}`;
    }
    // vless reality (tcp/grpc/xhttp)
    const params: Record<string, string> = {
      type: inbound.network,
      security: 'reality',
      pbk: node.realityPbk || '',
      sid: node.realitySid || '',
      sni: node.sni || '',
      fp: 'chrome',
      encryption: 'none',
    };
    if (inbound.network === 'tcp') params.flow = 'xtls-rprx-vision';
    if (inbound.network === 'grpc') params.serviceName = inbound.tag;
    if (inbound.network === 'xhttp') params.path = '/';
    const qs = Object.entries(params)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${this.enc(v)}`).join('&');
    return `vless://${uuid}@${host}:${inbound.port}?${qs}#${this.enc(tag)}`;
  }

  /** Общая выборка: устройство, юзер, бренд, ноды тенанта, статус блокировки. */
  private async resolve(token: string) {
    const device = await this.prisma.device.findUnique({
      where: { subToken: token },
      include: { user: { include: { tenant: true } } },
    });
    if (!device) throw new NotFoundException('подписка не найдена');
    const user = device.user;
    const brand = user.tenant?.brand || 'VPN';
    let nodes = await this.prisma.node.findMany({
      where: {
        isActive: true, showInSub: true,
        OR: [{ tenantId: null }, { tenantId: user.tenantId }],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { inbounds: true },
    });
    // Failover: не отдаём клиенту офлайн-ноды, если есть живые (монитор ставит online).
    // Если живых нет вовсе (монитор ещё не прошёл) — отдаём все, чтобы не оставить без VPN.
    const failover = (await this.prisma.setting.findUnique({ where: { key: 'sub.failover' } }))?.value;
    if (failover !== '0') {
      const onlineNodes = nodes.filter((n) => n.online);
      if (onlineNodes.length) nodes = onlineNodes;
    }
    // Балансировка: разным клиентам — разный порядок нод (детерминированно по токену),
    // чтобы приложения не грузили одну и ту же первую ноду. Внутри — стабильный сорт.
    if (nodes.length > 1) {
      const seed = Array.from(token).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      const shift = seed % nodes.length;
      nodes = nodes.slice(shift).concat(nodes.slice(0, shift));
    }
    const blocked = user.isBlocked ||
      (user.expireAt != null && user.expireAt.getTime() < Date.now());
    const bypassSuspended = await this.bypass.isSuspended(user.id);
    return { device, user, brand, nodes, blocked, bypassSuspended };
  }

  /**
   * HWID-лимит устройств: приложение (Happ/v2rayTun) шлёт заголовок x-hwid. Считаем
   * уникальные HWID клиента; при превышении лимита (настройка hwid.limit, 0=выкл)
   * НОВОЕ устройство не пускаем. Клиенты без hwid не блокируем (совместимость).
   */
  async hwidCheck(token: string, hwid?: string, os?: string, model?: string) {
    const limRow = await this.prisma.setting.findUnique({ where: { key: 'hwid.limit' } });
    const limit = limRow ? Number(limRow.value) || 0 : 0;
    if (!limit || !hwid) return; // лимит выкл или клиент не прислал hwid
    const device = await this.prisma.device.findUnique({ where: { subToken: token }, include: { user: true } });
    if (!device) return;
    const userId = device.userId;
    const existing = await this.prisma.userHwid.findUnique({ where: { userId_hwid: { userId, hwid } } });
    if (existing) {
      await this.prisma.userHwid.update({ where: { id: existing.id }, data: { lastSeen: new Date() } });
      return;
    }
    const count = await this.prisma.userHwid.count({ where: { userId } });
    if (count >= limit) {
      throw new ForbiddenException(`превышен лимит устройств (${limit}). Удалите старое устройство в поддержке.`);
    }
    await this.prisma.userHwid.create({ data: { userId, hwid, os, model } });
  }

  /** HWID-устройства клиента (для админки). */
  async hwids(userId: string) {
    return this.prisma.userHwid.findMany({ where: { userId }, orderBy: { lastSeen: 'desc' } });
  }
  async removeHwid(userId: string, id: string) {
    await this.prisma.userHwid.deleteMany({ where: { id, userId } });
    return { ok: true };
  }

  /** subToken по короткому ТВ-коду (для /t/<code>). */
  async tvToken(code: string): Promise<string> {
    const d = await this.prisma.device.findUnique({ where: { tvCode: (code || '').toUpperCase() } });
    if (!d) throw new NotFoundException('ТВ-код не найден');
    return d.subToken;
  }

  /** Возвращает {body(base64), expireUnix} для sub-токена (список vless/hy2 ссылок). */
  async build(token: string): Promise<{ body: string; expireUnix: number | null }> {
    const { device, user, brand, nodes, blocked, bypassSuspended } = await this.resolve(token);

    const links: string[] = [];
    if (!blocked && !bypassSuspended) {
      for (const n of nodes) {
        for (const ib of (n as any).inbounds) {
          const l = this.link(n, ib, device.vlessUuid, brand);
          if (l) links.push(l);
        }
      }
    }
    if (!links.length) {
      // информативная «нода-заглушка» вместо пустой подписки
      const msg = blocked ? 'Подписка неактивна — продлите доступ'
        : bypassSuspended ? `Лимит обхода исчерпан — докупите в ${await this.support()}`
        : 'Нет доступных серверов';
      links.push(`vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?type=tcp#${this.enc(msg)}`);
    }
    return {
      body: Buffer.from(links.join('\n')).toString('base64'),
      expireUnix: user.expireAt ? Math.floor(user.expireAt.getTime() / 1000) : null,
    };
  }

  /**
   * ПОЛНЫЙ клиентский xray-конфиг с УМНОЙ МАРШРУТИЗАЦИЕЙ (Этап G):
   *  - RU-сервисы (домены и IP РФ) идут НАПРЯМУЮ (банки/госуслуги не блокируют);
   *  - YouTube → на ноду с ролью 'yt-ru' (РФ-выход без рекламы), если такая есть;
   *  - остальной трафик → через VPN (первый exit-нод = default outbound).
   * Такой формат импортируют xray-клиенты (v2rayN/NG, Streisand и т.п.).
   */
  async buildXrayClientConfig(token: string): Promise<any> {
    const { device, brand, nodes, blocked, bypassSuspended } = await this.resolve(token);
    if (blocked) return { outbounds: [{ protocol: 'blackhole', tag: 'block' }], note: 'подписка неактивна' };
    if (bypassSuspended) return { outbounds: [{ protocol: 'blackhole', tag: 'block' }], note: `лимит обхода исчерпан — докупите в ${await this.support()}` };

    const uuid = device.vlessUuid;
    const outbounds: any[] = [];
    const proxyTags: string[] = [];
    let ytTag: string | null = null;

    for (const n of nodes as any[]) {
      const ib = n.inbounds.find((i: any) => i.network === 'tcp') || n.inbounds[0];
      if (!ib) continue;
      const tag = `${n.label}`;
      outbounds.push({
        tag,
        protocol: 'vless',
        settings: { vnext: [{ address: n.address, port: ib.port,
          users: [{ id: uuid, encryption: 'none', flow: ib.network === 'tcp' ? 'xtls-rprx-vision' : '' }] }] },
        streamSettings: {
          network: ib.network, security: 'reality',
          realitySettings: { publicKey: n.realityPbk, shortId: n.realitySid,
            serverName: n.sni, fingerprint: 'chrome' },
          ...(ib.network === 'grpc' ? { grpcSettings: { serviceName: ib.tag } } : {}),
        },
      });
      if (n.role === 'yt-ru') ytTag = tag; else proxyTags.push(tag);
    }
    // default proxy = первый exit; если только yt-нода — используем её
    const defaultProxy = proxyTags[0] || ytTag;
    if (!defaultProxy) return { outbounds: [{ protocol: 'blackhole', tag: 'block' }], note: 'нет серверов' };

    outbounds.push({ protocol: 'freedom', tag: 'direct' });
    outbounds.push({ protocol: 'blackhole', tag: 'block' });
    // default outbound должен быть ПЕРВЫМ — переставим defaultProxy в начало
    outbounds.sort((a, b) => (a.tag === defaultProxy ? -1 : b.tag === defaultProxy ? 1 : 0));

    const rules: any[] = [
      { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
    ];
    // кастомные сайты админа (приоритетнее стандартных): блок / напрямую / через VPN
    const custom = await this.customRouting();
    if (custom.block.length) rules.push({ type: 'field', domain: custom.block, outboundTag: 'block' });
    if (custom.direct.length) rules.push({ type: 'field', domain: custom.direct, outboundTag: 'direct' });
    if (custom.proxy.length) rules.push({ type: 'field', domain: custom.proxy, outboundTag: defaultProxy });
    // RU напрямую: домены РФ + IP РФ (банки, госуслуги, маркетплейсы)
    rules.push({ type: 'field', domain: ['geosite:category-ru', 'geosite:category-gov-ru'], outboundTag: 'direct' });
    rules.push({ type: 'field', ip: ['geoip:ru'], outboundTag: 'direct' });
    if (ytTag) {
      rules.push({ type: 'field',
        domain: ['geosite:youtube', 'domain:googlevideo.com', 'domain:ytimg.com', 'domain:ggpht.com'],
        outboundTag: ytTag });
    }

    return {
      remarks: `${brand} — умная маршрутизация`,
      log: { loglevel: 'warning' },
      inbounds: [
        { tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { udp: true } },
        { tag: 'http', port: 10809, listen: '127.0.0.1', protocol: 'http' },
      ],
      outbounds,
      routing: { domainStrategy: 'IPIfNonMatch', rules },
    };
  }
}
