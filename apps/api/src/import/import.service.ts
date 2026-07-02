import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NodesService } from '../nodes/nodes.service';

const GB = 1024n * 1024n * 1024n;

/**
 * Импорт базы из любой системы. Сущности (entity): users | payments | usage |
 * nodes | promocodes. Источники (source): normalized (уже наш формат) | mapping
 * (сырые строки + карта полей для ПРОИЗВОЛЬНОЙ базы, вкл. префиксы вроде cat_) |
 * remnawave (готовый адаптер, для users). Всегда есть dry-run (без записи).
 *
 * Сырьё (rows) готовит либо клиент, либо CLI-экстрактор tools/extract.mjs,
 * который умеет читать SQLite/MySQL/PostgreSQL.
 */
@Injectable()
export class ImportService {
  private readonly log = new Logger(ImportService.name);
  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private nodes: NodesService,
  ) {}

  // ── универсальный маппинг сырой строки: target -> {from, stripPrefix} ──────
  private applyMap(row: any, map: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [target, spec] of Object.entries<any>(map || {})) {
      if (!spec?.from) continue;
      let v = row[spec.from];
      if (v != null && spec.stripPrefix && String(v).startsWith(spec.stripPrefix)) {
        v = String(v).slice(spec.stripPrefix.length);
      }
      out[target] = v;
    }
    return out;
  }

  private rowsToRecords(body: ImportBody): any[] {
    if (body.source === 'normalized') return body.rows;
    if (body.source === 'remnawave') return this.fromRemnawave(body.rows);
    if (body.source === 'mapping') {
      if (!body.mapping) throw new BadRequestException('нужна карта полей mapping');
      return body.rows.map((r) => this.applyMap(r, body.mapping!));
    }
    throw new BadRequestException('source: normalized | mapping | remnawave');
  }

  private fromRemnawave(rows: any[]): any[] {
    return rows.map((u) => ({
      tgId: u.telegramId ?? u.tgId, externalId: u.uuid ?? u.shortUuid ?? (u.telegramId ? `rw_${u.telegramId}` : undefined),
      username: u.username, name: u.name, expireAt: u.expireAt ?? u.expire,
      isBlocked: u.status && String(u.status).toUpperCase() !== 'ACTIVE',
      devices: u.vlessUuid ? [u.vlessUuid] : (u.subscriptionUuid ? [u.subscriptionUuid] : undefined),
    }));
  }

  private parseExpire(v: any, as?: string): Date | null {
    if (v == null || v === '') return null;
    if (as === 'daysFromNow') { const d = new Date(); d.setDate(d.getDate() + Number(v)); return d; }
    if (as === 'unixSeconds') return new Date(Number(v) * 1000);
    if (as === 'unixMs') return new Date(Number(v));
    if (typeof v === 'number' || /^\d+$/.test(String(v))) { const n = Number(v); return new Date(n > 1e12 ? n : n * 1000); }
    const d = new Date(v); return isNaN(d.getTime()) ? null : d;
  }

  private async findUser(tenantId: string, ext?: any, tg?: any) {
    if (ext != null && ext !== '') {
      const u = await this.prisma.user.findFirst({ where: { tenantId, externalId: String(ext) } });
      if (u) return u;
    }
    if (tg != null && tg !== '') {
      const n = String(tg).replace(/\D/g, '');
      if (n) return this.prisma.user.findFirst({ where: { tenantId, tgId: BigInt(n) } });
    }
    return null;
  }

  // ── DISPATCH ───────────────────────────────────────────────────────────────
  async dryRun(body: ImportBody) {
    const entity = body.entity || 'users';
    const recs = this.rowsToRecords(body);
    if (entity === 'users') return this.dryUsers(recs);
    if (entity === 'nodes') return this.dryNodes(recs);
    return { dryRun: true, entity, total: recs.length, sample: recs.slice(0, 5) };
  }

  async run(body: ImportBody) {
    const entity = body.entity || 'users';
    const recs = this.rowsToRecords(body);
    const tenantId = body.tenantId ?? (await this.users.platformTenantId());
    switch (entity) {
      case 'users': return this.runUsers(recs, tenantId);
      case 'payments': return this.runPayments(recs, tenantId);
      case 'usage': return this.runUsage(recs, tenantId);
      case 'nodes': return this.runNodes(recs);
      case 'promocodes': return this.runPromocodes(recs);
      default: throw new BadRequestException('entity: users|payments|usage|nodes|promocodes');
    }
  }

  // ── USERS ────────────────────────────────────────────────────────────────
  private dryUsers(recs: any[]) {
    let ok = 0, noId = 0, noExpire = 0, dev = 0;
    for (const r of recs) {
      if (!r.tgId && !r.externalId) { noId++; continue; }
      if (!r.expireAt) noExpire++;
      if (r.devices?.length) dev++;
      ok++;
    }
    const issues: string[] = [];
    if (noId) issues.push(`${noId} без tgId/externalId — пропустятся`);
    if (noExpire) issues.push(`${noExpire} без срока`);
    return { dryRun: true, entity: 'users', total: recs.length, importable: ok, skipped: noId, withDevices: dev, issues, sample: recs.slice(0, 5) };
  }

  private async runUsers(recs: any[], tenantId: string) {
    let created = 0, updated = 0, skipped = 0, devices = 0;
    for (const r of recs) {
      if (!r.tgId && !r.externalId) { skipped++; continue; }
      const tgId = r.tgId != null ? BigInt(String(r.tgId).replace(/\D/g, '') || '0') : 0n;
      const expireAt = this.parseExpire(r.expireAt);
      let user = await this.findUser(tenantId, r.externalId, r.tgId);
      if (user) {
        user = await this.prisma.user.update({ where: { id: user.id }, data: {
          expireAt: expireAt ?? user.expireAt, externalId: r.externalId ?? user.externalId,
          tgUsername: r.username ?? user.tgUsername, tgName: r.name ?? user.tgName,
          isBlocked: r.isBlocked ?? user.isBlocked, isTrial: false } });
        updated++;
      } else {
        user = await this.prisma.user.create({ data: {
          tenantId, tgId, externalId: r.externalId ? String(r.externalId) : null,
          tgUsername: r.username, tgName: r.name, expireAt, isTrial: false, isBlocked: !!r.isBlocked } });
        created++;
      }
      const devs = Array.isArray(r.devices) ? r.devices : (r.devices ? [r.devices] : []);
      for (const d of devs) {
        const uuid = typeof d === 'string' ? d : d?.uuid;
        if (!uuid) continue;
        if (await this.prisma.device.findUnique({ where: { vlessUuid: uuid } })) continue;
        await this.prisma.device.create({ data: { userId: user.id, name: 'Импорт', vlessUuid: uuid, subToken: randomBytes(24).toString('hex') } });
        devices++;
      }
    }
    this.log.log(`users: +${created}/${updated}, устройств ${devices}`);
    return { ok: true, entity: 'users', created, updated, skipped, devices };
  }

  // ── PAYMENTS (архив истории) ───────────────────────────────────────────────
  private async runPayments(recs: any[], tenantId: string) {
    let created = 0, skipped = 0;
    for (const r of recs) {
      const user = await this.findUser(tenantId, r.userExternalId, r.userTgId);
      if (!user) { skipped++; continue; }
      // дедуп по внешнему id платежа
      if (r.externalId && await this.prisma.payment.findFirst({ where: { invoiceId: String(r.externalId) } })) { skipped++; continue; }
      await this.prisma.payment.create({ data: {
        tenantId, userId: user.id, amount: Number(r.amount) || 0,
        method: r.method ? String(r.method) : 'import', status: r.status ? String(r.status) : 'paid',
        invoiceId: r.externalId ? String(r.externalId) : null, days: r.days != null ? Number(r.days) : null,
        paidAt: this.parseExpire(r.createdAt), createdAt: this.parseExpire(r.createdAt) ?? undefined } as any });
      created++;
    }
    return { ok: true, entity: 'payments', created, skipped };
  }

  // ── USAGE (счётчики трафика/обхода) ────────────────────────────────────────
  private async runUsage(recs: any[], tenantId: string) {
    let applied = 0, skipped = 0;
    for (const r of recs) {
      const user = await this.findUser(tenantId, r.userExternalId, r.userTgId);
      if (!user) { skipped++; continue; }
      const bytes = r.usedBytes != null ? BigInt(Math.round(Number(r.usedBytes)))
        : r.usedGb != null ? BigInt(Math.round(Number(r.usedGb) * Number(GB))) : 0n;
      await this.prisma.bypassUsage.upsert({
        where: { userId: user.id },
        update: { totalBytes: bytes, capGb: r.capGb != null ? Number(r.capGb) : undefined },
        create: { userId: user.id, totalBytes: bytes, capGb: r.capGb != null ? Number(r.capGb) : null } });
      applied++;
    }
    return { ok: true, entity: 'usage', applied, skipped };
  }

  // ── NODES (метаданные; серверы всё равно ставятся install-node.sh) ─────────
  private dryNodes(recs: any[]) {
    const bad = recs.filter((r) => !r.ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(r.ip)));
    return { dryRun: true, entity: 'nodes', total: recs.length, importable: recs.length - bad.length,
      issues: bad.length ? [`${bad.length} без валидного IP`] : [],
      note: 'Импорт создаёт запись+команду установки. Сервер надо поднять install-node.sh (агент не мигрирует).',
      sample: recs.slice(0, 5) };
  }

  private async runNodes(recs: any[]) {
    const installs: any[] = [];
    let created = 0, skipped = 0;
    for (const r of recs) {
      if (!r.ip || !r.label || !r.address) { skipped++; continue; }
      const protocols = Array.isArray(r.protocols) ? r.protocols
        : (typeof r.protocols === 'string' ? r.protocols.split(',').map((s: string) => s.trim()) : ['reality-tcp']);
      const res = await this.nodes.create({ label: r.label, address: r.address, ip: String(r.ip),
        protocols, role: r.role || 'exit', sni: r.sni } as any);
      installs.push({ label: r.label, install: res.install });
      created++;
    }
    return { ok: true, entity: 'nodes', created, skipped, installs,
      note: 'Выполни install-команды на серверах — только тогда ноды заработают.' };
  }

  // ── PROMOCODES ──────────────────────────────────────────────────────────────
  private async runPromocodes(recs: any[]) {
    let created = 0, skipped = 0;
    for (const r of recs) {
      if (!r.code) { skipped++; continue; }
      if (await this.prisma.promoCode.findUnique({ where: { code: String(r.code) } })) { skipped++; continue; }
      await this.prisma.promoCode.create({ data: {
        code: String(r.code), type: r.type ? String(r.type) : 'days',
        value: Number(r.value) || 0, maxUses: r.maxUses != null ? Number(r.maxUses) : 1 } });
      created++;
    }
    return { ok: true, entity: 'promocodes', created, skipped };
  }
}

export interface ImportBody {
  source: 'normalized' | 'mapping' | 'remnawave';
  entity?: 'users' | 'payments' | 'usage' | 'nodes' | 'promocodes';
  rows: any[];
  mapping?: Record<string, { from: string; stripPrefix?: string }>;
  tenantId?: string;
}
