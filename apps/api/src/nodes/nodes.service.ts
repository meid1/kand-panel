import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { WarpService } from '../warp/warp.service';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';
import { ReconcileService } from '../reconcile/reconcile.service';
import { CreateNodeDto, Protocol } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';

/**
 * Управление нодами: добавление «одной командой», выпуск mTLS-кред, генерация
 * Reality-ключей, набор инбаундов по выбранным протоколам, CRUD, сортировка.
 *
 * Секрет ноды (secretKey) — base64(JSON) c её серверным сертом+ключом, публичным
 * CA-сертом и общим JWT-секретом. Приватные ключи CA/панели в bundle НЕ попадают.
 */
@Injectable()
export class NodesService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private config: ConfigService,
    private warp: WarpService,
    private agent: NodeAgentClient,
    private reconcile: ReconcileService,
  ) {}

  // ── Reality X25519: xray ждёт base64url(raw 32 байта) ────────────────────
  private realityKeypair(): { pbk: string; pvk: string } {
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    const pub = publicKey.export({ format: 'jwk' }) as { x: string };
    const prv = privateKey.export({ format: 'jwk' }) as { d: string };
    // jwk уже base64url без паддинга — ровно формат xray
    return { pbk: pub.x, pvk: prv.d };
  }

  // короткий shortId Reality (8 байт hex)
  private shortId(): string {
    return randomBytes(8).toString('hex');
  }

  /** Инбаунды под выбранные протоколы (структура для xray-конфига ноды). */
  private buildInbounds(protocols: Protocol[], basePort: number) {
    const map: Record<Protocol, { protocol: string; network: string }> = {
      'reality-tcp': { protocol: 'vless', network: 'tcp' },
      'reality-grpc': { protocol: 'vless', network: 'grpc' },
      hysteria2: { protocol: 'hysteria2', network: 'udp' },
      xhttp: { protocol: 'vless', network: 'xhttp' },
    };
    // порт: reality-tcp на основном (443), остальные разносим (+1,+2…)
    let extra = 0;
    return protocols.map((p) => {
      const m = map[p];
      const port = p === 'reality-tcp' ? basePort : basePort + ++extra;
      return { tag: p, protocol: m.protocol, network: m.network, port };
    });
  }

  async create(dto: CreateNodeDto) {
    if (!dto.protocols?.length) throw new BadRequestException('нужен хотя бы один протокол');
    dto.address = (dto.address || '').trim() || dto.ip; // пусто → адрес = IP

    const port = dto.port ?? 443;
    const reality = this.realityKeypair();
    const sid = this.shortId();
    const sni = dto.sni ?? 'www.microsoft.com';
    const ibs = this.buildInbounds(dto.protocols, port);

    // mTLS-креды ноды + общий CA/JWT
    const nodeCert = await this.crypto.issueNodeCert(dto.ip, dto.address);
    const caPem = await this.crypto.getCaCertPem();
    const jwt = await this.crypto.getNodeJwtSecret();

    // WARP (чистый IP для нейросетей): регистрируем ключ, если включено
    let warpKey: string | null = null;
    if (dto.warp) warpKey = await this.warp.register();

    // ПОЛНЫЙ базовый xray-конфиг ноды кладём в bundle — установщик просто пишет
    // его на диск, ничего сам не собирает (dumb installer = меньше багов).
    const xray = this.buildXrayConfig(ibs, reality.pvk, sid, sni, warpKey);

    const bundle = Buffer.from(
      JSON.stringify({
        cert: nodeCert.certPem,
        key: nodeCert.keyPem,
        ca: caPem,
        jwt,
        agent_port: 8443,
        xray, // базовый конфиг xray (инбаунды + reality + api + routing)
      }),
    ).toString('base64');

    const node = await this.prisma.node.create({
      data: {
        tenantId: dto.tenantId ?? null,
        label: dto.label,
        address: dto.address,
        ip: dto.ip,
        port,
        protocols: dto.protocols,
        sni,
        realityPbk: reality.pbk,
        realitySid: sid,
        secretKey: bundle,
        role: dto.role ?? 'exit',
        warpKey,
        trafficLimitGb: dto.trafficLimitGb ?? null,
        showInSub: dto.showInSub ?? true,
        inbounds: {
          create: ibs.map((i) => ({
            tag: i.tag, protocol: i.protocol, network: i.network, port: i.port,
          })),
        } as any,
      },
    });

    const install = this.installCommand(node.id, bundle);
    return { node: this.strip(node), install };
  }

  /**
   * Ручное добавление УЖЕ настроенного сервера (не управляется агентом Kand):
   * оператор вводит свои reality-параметры (pbk/sid/sni/порты). Kand только отдаёт
   * такие ссылки в подписке. Установка/агент не нужны — сервер уже поднят.
   */
  async addExisting(b: any) {
    const protocols: string[] = Array.isArray(b.protocols) && b.protocols.length ? b.protocols : ['reality-tcp'];
    if (!b.ip) throw new BadRequestException('нужен IP');
    const address = (b.address || '').trim() || b.ip;
    const port = Number(b.port) || 443;
    const grpcPort = Number(b.grpcPort) || port;
    const ibs = protocols.map((p) => {
      const net = p === 'reality-grpc' ? 'grpc' : p === 'xhttp' ? 'xhttp' : p === 'hysteria2' ? 'hysteria2' : 'tcp';
      return {
        protocol: p === 'hysteria2' ? 'hysteria2' : 'vless',
        network: net,
        tag: net === 'grpc' ? (b.grpcServiceName || 'grpc') : net,
        port: net === 'grpc' ? grpcPort : port,
      };
    });
    const node = await this.prisma.node.create({
      data: {
        tenantId: b.tenantId ?? null,
        label: b.label || address, address, ip: String(b.ip), port,
        protocols, sni: b.sni || 'www.google.com',
        realityPbk: b.realityPbk || '', realitySid: b.realitySid || '',
        secretKey: 'manual', role: b.role || 'exit', showInSub: true,
        inbounds: { create: ibs.map((i) => ({ tag: i.tag, protocol: i.protocol, network: i.network, port: i.port })) } as any,
      },
    });
    return { node: this.strip(node) };
  }

  /** Базовый xray-конфиг: reality/xhttp-инбаунды + api + routing (+ WARP если задан). */
  private buildXrayConfig(
    ibs: { tag: string; protocol: string; network: string; port: number }[],
    pvk: string, sid: string, sni: string, warpKey?: string | null,
  ) {
    const dest = `${sni}:443`;
    const inbounds: any[] = [];
    for (const i of ibs) {
      if (i.protocol === 'hysteria2') continue; // xray-core не умеет hy2 (нужен sing-box) — пропускаем
      const stream: any = {
        network: i.network,
        security: 'reality',
        realitySettings: { dest, serverNames: [sni], privateKey: pvk, shortIds: [sid] },
      };
      if (i.network === 'grpc') stream.grpcSettings = { serviceName: i.tag };
      if (i.network === 'xhttp') stream.xhttpSettings = { path: '/' };
      inbounds.push({
        tag: i.tag, port: i.port, protocol: 'vless',
        settings: { clients: [], decryption: 'none' },
        streamSettings: stream,
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
      });
    }
    // API-инбаунд (для live add/remove клиентов через `xray api`)
    inbounds.push({
      tag: 'api', listen: '127.0.0.1', port: 10085,
      protocol: 'dokodemo-door', settings: { address: '127.0.0.1' },
    });
    return {
      log: { loglevel: 'warning' },
      api: { tag: 'api', services: ['HandlerService', 'StatsService'] },
      stats: {}, // включаем сбор статистики
      policy: {
        // per-user учёт трафика (для лимитов/обхода) + системный
        levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
        system: { statsInboundUplink: true, statsInboundDownlink: true },
      },
      inbounds,
      outbounds: [
        { protocol: 'freedom', tag: 'direct' },
        { protocol: 'blackhole', tag: 'block' },
        // WARP-outbound (чистый IP Cloudflare для нейросетей)
        ...(warpKey ? [this.warp.outbound(warpKey)] : []),
      ],
      routing: {
        rules: [
          { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
          // ИИ-домены → WARP (чтобы нейросети видели чистый IP, без капчи)
          ...(warpKey ? [this.warp.aiRule()] : []),
        ],
      },
    };
  }

  /** Одна команда для установки ноды (агент + xray + конфиг) — весь секрет в bundle. */
  private installCommand(nodeId: string, bundle: string): string {
    const base = this.config.get<string>('PANEL_URL') || 'https://panel.example.com';
    // install-node.sh скачивается с панели; секреты передаём env (не в argv-логах)
    return (
      `curl -fsSL ${base}/install-node.sh | ` +
      `NODE_ID=${nodeId} PANEL_URL=${base} NODE_BUNDLE='${bundle}' bash`
    );
  }

  async findAll(tenantId?: string) {
    const nodes = await this.prisma.node.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { inbounds: true } as any,
    });
    return nodes.map((n) => this.strip(n));
  }

  async findOne(id: string) {
    const n = await this.prisma.node.findUnique({
      where: { id }, include: { inbounds: true } as any,
    });
    if (!n) throw new NotFoundException('нода не найдена');
    return this.strip(n);
  }

  async update(id: string, dto: UpdateNodeDto) {
    await this.findOne(id);
    const n = await this.prisma.node.update({ where: { id }, data: dto });
    return this.strip(n);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.keySyncStatus.deleteMany({ where: { nodeId: id } });
    await this.prisma.inbound.deleteMany({ where: { nodeId: id } });
    await this.prisma.node.delete({ where: { id } });
    return { ok: true };
  }

  /** Проверка ноды по кнопке: пинг агента + замер задержки, обновляет online/lastCheck. */
  async checkHealth(id: string) {
    const n = await this.prisma.node.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('нода не найдена');
    const t0 = Date.now();
    let online = false; let latencyMs: number | null = null; let error: string | null = null;
    try {
      await this.agent.health(n.ip, 8443);
      online = true; latencyMs = Date.now() - t0;
    } catch (e: any) { error = e?.message || 'нет ответа от агента'; }
    const lastCheck = new Date();
    await this.prisma.node.update({ where: { id }, data: { online, lastCheck } });
    return { online, latencyMs, lastCheck, error };
  }

  // ── правка конфига установленных нод + ручные материалы ──────────────────
  private decodeBundle(secretKey: string): any {
    try { return JSON.parse(Buffer.from(secretKey, 'base64').toString()); } catch { return {}; }
  }

  /** Текущий xray-конфиг ноды (для просмотра/правки). */
  async getConfig(id: string) {
    const n = await this.prisma.node.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('нода не найдена');
    return this.decodeBundle(n.secretKey).xray || {};
  }

  /** Заменить xray-конфиг: сохранить в bundle + запушить на агент + восстановить клиентов. */
  async setConfig(id: string, config: any) {
    const n = await this.prisma.node.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('нода не найдена');
    const bundle = this.decodeBundle(n.secretKey);
    bundle.xray = config;
    await this.prisma.node.update({
      where: { id }, data: { secretKey: Buffer.from(JSON.stringify(bundle)).toString('base64') },
    });
    // пуш на живой агент (если нода поднята); затем восстановить ключи клиентов
    let pushed = false, error: string | undefined;
    try {
      await this.agent.setConfig(n.ip, bundle.agent_port || 8443, config);
      await this.reconcile.reconcileNode(id);
      pushed = true;
    } catch (e: any) { error = String(e.message || e); }
    return { ok: true, pushed, error };
  }

  /** Включить/выключить WARP на УЖЕ созданной ноде (регистрация ключа + пуш конфига). */
  async setWarp(id: string, enable: boolean) {
    const n = await this.prisma.node.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('нода не найдена');
    const bundle = this.decodeBundle(n.secretKey);
    const xray = bundle.xray || {};
    xray.outbounds = xray.outbounds || [];
    xray.routing = xray.routing || { rules: [] };
    let warpKey = n.warpKey;

    if (enable) {
      if (!warpKey) {
        warpKey = await this.warp.register();
        if (!warpKey) throw new BadRequestException('не удалось зарегистрировать WARP (Cloudflare)');
      }
      if (!xray.outbounds.some((o: any) => o.tag === 'warp')) xray.outbounds.push(this.warp.outbound(warpKey));
      if (!xray.routing.rules.some((r: any) => r.outboundTag === 'warp')) xray.routing.rules.push(this.warp.aiRule());
    } else {
      xray.outbounds = xray.outbounds.filter((o: any) => o.tag !== 'warp');
      xray.routing.rules = xray.routing.rules.filter((r: any) => r.outboundTag !== 'warp');
      warpKey = null;
    }
    bundle.xray = xray;
    await this.prisma.node.update({
      where: { id }, data: { warpKey, secretKey: Buffer.from(JSON.stringify(bundle)).toString('base64') },
    });
    let pushed = false, error: string | undefined;
    try { await this.agent.setConfig(n.ip, bundle.agent_port || 8443, xray); await this.reconcile.reconcileNode(id); pushed = true; }
    catch (e: any) { error = String(e.message || e); }
    return { ok: true, warp: enable, pushed, error };
  }

  /** Материалы для РУЧНОЙ установки ноды (админ ставит сам, без curl|bash). */
  async manual(id: string) {
    const n = await this.prisma.node.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('нода не найдена');
    const b = this.decodeBundle(n.secretKey);
    return {
      agentPort: b.agent_port || 8443,
      files: {
        '/etc/vpanel/agent.crt': b.cert,
        '/etc/vpanel/agent.key': b.key,
        '/etc/vpanel/ca.crt': b.ca,
      },
      env: { AGENT_JWT_SECRET: b.jwt },
      xrayConfig: b.xray,
      hint: 'Поставь xray + vpanel-agent, разложи файлы, задай AGENT_JWT_SECRET и порт, положи xrayConfig в /usr/local/etc/xray/config.json, запусти агент.',
    };
  }

  /** Перестановка нод в подписке (drag-reorder в админке). */
  async reorder(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.node.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    return { ok: true };
  }

  /** Убираем секреты из ответа API (secretKey/pvk никогда не отдаём в UI). */
  private strip(n: any) {
    const { secretKey, warpKey, ...safe } = n; // секреты наружу не отдаём
    (safe as any).warp = !!warpKey; // но флаг «WARP включён» показываем
    return safe;
  }
}
