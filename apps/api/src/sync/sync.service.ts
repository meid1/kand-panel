import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Живая синхронизация из БД бота (MySQL vpn_db) в Kand-Postgres. Импорт был
 * РАЗОВЫМ снимком — новые юзеры/оплаты/продления идут в vpn_db через бота и в
 * панели не видны. Этот сервис инкрементально подтягивает их, чтобы дашборд/
 * финансы/список клиентов отражали ЖИВОЙ прод.
 *
 * Ключ пользователя — telegram_id (Kand User.tgId, @@unique([tenantId,tgId])).
 * Оплаты дедупятся по invoiceId=`catpay_<vpn_db.payments.id>`; курсор последнего
 * обработанного id хранится в Setting (без миграций схемы).
 *
 * Активен только если заданы BRIDGE_DB_* и SYNC_VPNDB_TENANT_ID — иначе no-op.
 * Направление строго ОДНОСТОРОННЕЕ (vpn_db → Kand, только чтение из MySQL).
 */
@Injectable()
export class SyncService implements OnModuleDestroy {
  private readonly log = new Logger(SyncService.name);
  private pool: any = null;
  private running = false;
  private last: { at: string; created: number; updated: number; payments: number; error?: string } | null = null;

  constructor(private prisma: PrismaService) {}

  private readonly tenantId = process.env.SYNC_VPNDB_TENANT_ID || '';
  private readonly CURSOR_KEY = 'sync:catalyc:payCursor';
  // типы платежей vpn_db, которые считаем РЕАЛЬНЫМ доходом (status='paid' в Kand)
  private readonly PAID_TYPES = new Set(['YooCassa', 'YooCassa_gb']);

  get enabled() {
    return !!(process.env.BRIDGE_DB_HOST && process.env.BRIDGE_DB_USER && process.env.BRIDGE_DB_NAME && this.tenantId);
  }

  private async db() {
    if (this.pool) return this.pool;
    const mysql = await import('mysql2/promise');
    this.pool = mysql.createPool({
      host: process.env.BRIDGE_DB_HOST,
      port: Number(process.env.BRIDGE_DB_PORT) || 3306,
      user: process.env.BRIDGE_DB_USER,
      password: process.env.BRIDGE_DB_PASS || '',
      database: process.env.BRIDGE_DB_NAME,
      connectionLimit: 4,
      timezone: 'Z',
    });
    return this.pool;
  }

  async onModuleDestroy() { if (this.pool) await this.pool.end().catch(() => {}); }

  status() {
    return { enabled: this.enabled, tenantId: this.tenantId || null, running: this.running, last: this.last };
  }

  private async getSetting(key: string): Promise<string | null> {
    const r = await this.prisma.setting.findUnique({ where: { key } });
    return r?.value ?? null;
  }
  private async setSetting(key: string, value: string) {
    await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  @Interval(180_000) // фоновая подметалка (регистрации без оплаты, ручные баны); основной путь — ленивый синк при просмотре
  async tick() {
    if (!this.enabled || this.running) return;
    await this.syncOnce().catch((e) => this.log.warn(`sync tick: ${e.message || e}`));
  }

  /** Полный проход синхронизации. Идемпотентен, можно звать вручную. */
  async syncOnce() {
    if (!this.enabled) return { skipped: 'sync выключен (нет BRIDGE_DB_*/SYNC_VPNDB_TENANT_ID)' };
    if (this.running) return { skipped: 'уже идёт' };
    this.running = true;
    const tenantId = this.tenantId;
    let created = 0, updated = 0, payments = 0;
    try {
      const db = await this.db();

      // 1) пользователи vpn_db + срок последней подписки + бан
      const [urows] = await db.query(
        `SELECT u.telegram_id AS tg, u.is_banned AS ban, u.registered_at AS reg,
                (SELECT MAX(s.expired_date) FROM subscriptions s WHERE s.user_id = u.id) AS exp
         FROM users u WHERE u.telegram_id IS NOT NULL`,
      );

      // 2) пользователи Kand этого тенанта (по tgId)
      const kUsers = await this.prisma.user.findMany({
        where: { tenantId }, select: { id: true, tgId: true, expireAt: true, isBlocked: true },
      });
      const kByTg = new Map<string, { id: string; expireAt: Date | null; isBlocked: boolean }>();
      for (const u of kUsers) kByTg.set(u.tgId.toString(), { id: u.id, expireAt: u.expireAt, isBlocked: u.isBlocked });

      // 3) upsert: создаём новых, обновляем срок/бан у изменившихся
      for (const r of urows as any[]) {
        const tg = String(r.tg);
        if (!tg || tg === 'null') continue;
        const exp: Date | null = r.exp ? new Date(r.exp) : null;
        const ban = !!r.ban;
        const k = kByTg.get(tg);
        if (!k) {
          try {
            const nu = await this.prisma.user.create({
              data: {
                tenantId, tgId: BigInt(tg), externalId: `cat_${tg}`,
                expireAt: exp, isBlocked: ban, isTrial: false,
                ...(r.reg ? { createdAt: new Date(r.reg) } : {}),
              },
              select: { id: true },
            });
            kByTg.set(tg, { id: nu.id, expireAt: exp, isBlocked: ban });
            created++;
          } catch (e: any) { this.log.warn(`sync create tg=${tg}: ${e.message || e}`); }
        } else {
          const diff = (exp?.getTime() || 0) !== (k.expireAt?.getTime() || 0) || ban !== k.isBlocked;
          if (diff) {
            await this.prisma.user.update({ where: { id: k.id }, data: { expireAt: exp, isBlocked: ban } });
            k.expireAt = exp; k.isBlocked = ban; updated++;
          }
        }
      }

      // 4) платежи — инкрементально по id-курсору
      const cur = await this.ensureCursor(db, tenantId);
      const [prows] = await db.query(
        `SELECT p.id, p.user_id, p.amount, p.type, p.status, p.created_at, p.duration_days, u.telegram_id AS tg
         FROM payments p JOIN users u ON u.id = p.user_id
         WHERE p.id > ? ORDER BY p.id LIMIT 2000`,
        [cur],
      );
      let maxId = cur;
      for (const p of prows as any[]) {
        maxId = Math.max(maxId, Number(p.id));
        const k = kByTg.get(String(p.tg));
        if (!k) continue; // юзер не найден (маловероятно после шага 3)
        if (await this.insertPayment(tenantId, p, k.id)) payments++;
      }
      if (maxId > cur) await this.setSetting(this.CURSOR_KEY, String(maxId));

      this.last = { at: new Date().toISOString(), created, updated, payments };
      if (created || updated || payments) this.log.log(`sync: +${created} юзеров, ~${updated} обновл., +${payments} платежей`);
      return this.last;
    } catch (e: any) {
      this.last = { at: new Date().toISOString(), created, updated, payments, error: e.message || String(e) };
      this.log.warn(`sync ошибка: ${e.message || e}`);
      throw e;
    } finally {
      this.running = false;
    }
  }

  // ── ЛЁГКИЙ СИНК ПО ЗАПРОСУ (для «моментальности» при просмотре) ──────────────
  /**
   * Быстрый догон: только НОВЫЕ платежи по курсору + точечное обновление срока/бана
   * их клиентов (продление = новый платёж → появляется сразу). Дёшев — гоняется
   * перед показом дашборда/списков, чтобы админ видел свежие данные без ожидания
   * фонового цикла. Регистрации без оплаты и ручные баны добьёт фоновый syncOnce.
   */
  async syncLight() {
    if (!this.enabled) return { skipped: 'sync выключен' };
    const tenantId = this.tenantId;
    let payments = 0, updated = 0;
    const db = await this.db();
    const cur = await this.ensureCursor(db, tenantId);
    const [prows] = await db.query(
      `SELECT p.id, p.user_id, p.amount, p.type, p.status, p.created_at, p.duration_days, u.telegram_id AS tg,
              u.is_banned AS ban, (SELECT MAX(s.expired_date) FROM subscriptions s WHERE s.user_id=u.id) AS exp
       FROM payments p JOIN users u ON u.id = p.user_id
       WHERE p.id > ? ORDER BY p.id LIMIT 2000`,
      [cur],
    );
    let maxId = cur;
    for (const p of prows as any[]) {
      maxId = Math.max(maxId, Number(p.id));
      const uid = await this.upsertUser(tenantId, String(p.tg), p.exp ? new Date(p.exp) : null, !!p.ban);
      if (!uid) continue;
      if (uid.updated) updated++;
      if (await this.insertPayment(tenantId, p, uid.id)) payments++;
    }
    if (maxId > cur) await this.setSetting(this.CURSOR_KEY, String(maxId));
    if (payments || updated) this.last = { at: new Date().toISOString(), created: 0, updated, payments };
    return { payments, updated };
  }

  /**
   * Точечный синк ОДНОГО клиента по tgId (для открытия карточки): реальный срок/бан
   * из vpn_db + все его платежи, которых ещё нет в Kand. Всегда мгновенно.
   */
  async syncUser(tgId: string | number) {
    if (!this.enabled) return { skipped: 'sync выключен' };
    const tenantId = this.tenantId;
    const tg = String(tgId).replace(/\D/g, '');
    if (!tg) return { skipped: 'нет tgId' };
    const db = await this.db();
    const [urows] = await db.query(
      `SELECT u.id, u.is_banned AS ban,
              (SELECT MAX(s.expired_date) FROM subscriptions s WHERE s.user_id=u.id) AS exp
       FROM users u WHERE u.telegram_id=? LIMIT 1`,
      [tg],
    );
    const u = (urows as any[])[0];
    if (!u) return { found: false };
    const up = await this.upsertUser(tenantId, tg, u.exp ? new Date(u.exp) : null, !!u.ban);
    if (!up) return { found: false };
    // новые платежи именно этого клиента (дедуп по invoiceId)
    const [prows] = await db.query(
      'SELECT id, amount, type, status, created_at, duration_days FROM payments WHERE user_id=? ORDER BY id',
      [u.id],
    );
    let payments = 0;
    for (const p of prows as any[]) {
      const exists = await this.prisma.payment.findFirst({ where: { tenantId, invoiceId: `catpay_${p.id}` }, select: { id: true } });
      if (exists) continue;
      if (await this.insertPayment(tenantId, { ...p, tg }, up.id)) payments++;
    }
    return { found: true, updated: up.updated, payments };
  }

  /** Точечный синк по внутреннему id клиента Kand (карточка вызывает по id). */
  async syncUserById(id: string) {
    if (!this.enabled) return { skipped: 'sync выключен' };
    const u = await this.prisma.user.findUnique({ where: { id }, select: { tgId: true } });
    if (!u) return { found: false };
    return this.syncUser(u.tgId.toString());
  }

  // ── общие помощники ─────────────────────────────────────────────────────────
  /** Создаёт клиента, если его нет; иначе обновляет срок/бан при отличии. */
  private async upsertUser(tenantId: string, tg: string, exp: Date | null, ban: boolean): Promise<{ id: string; updated: boolean } | null> {
    if (!tg || tg === 'null') return null;
    try {
      const k = await this.prisma.user.findFirst({ where: { tenantId, tgId: BigInt(tg) }, select: { id: true, expireAt: true, isBlocked: true } });
      if (!k) {
        const nu = await this.prisma.user.create({
          data: { tenantId, tgId: BigInt(tg), externalId: `cat_${tg}`, expireAt: exp, isBlocked: ban, isTrial: false },
          select: { id: true },
        });
        return { id: nu.id, updated: true };
      }
      const diff = (exp?.getTime() || 0) !== (k.expireAt?.getTime() || 0) || ban !== k.isBlocked;
      if (diff) await this.prisma.user.update({ where: { id: k.id }, data: { expireAt: exp, isBlocked: ban } });
      return { id: k.id, updated: diff };
    } catch (e: any) { this.log.warn(`upsertUser tg=${tg}: ${e.message || e}`); return null; }
  }

  /** Вставка платежа из vpn_db в Kand с дедупом по invoiceId. true если создан. */
  private async insertPayment(tenantId: string, p: any, userId: string): Promise<boolean> {
    const isPaid = this.PAID_TYPES.has(p.type) && p.status === 'SUCCESS' && Number(p.amount) > 0;
    try {
      await this.prisma.payment.create({
        data: {
          tenantId, userId, amount: Number(p.amount) || 0,
          method: p.type || 'unknown', status: isPaid ? 'paid' : 'granted',
          invoiceId: `catpay_${p.id}`, days: p.duration_days ? Number(p.duration_days) : null,
          description: p.type || null,
          createdAt: new Date(p.created_at), paidAt: new Date(p.created_at),
        },
      });
      return true;
    } catch (e: any) {
      // уникальный invoiceId → дубль, это норма при гонке; прочее логируем
      if (!/Unique|duplicate/i.test(e.message || '')) this.log.warn(`insertPayment ${p.id}: ${e.message || e}`);
      return false;
    }
  }

  /** Курсор платежей: инициализация выравнивает его на то, что в Kand уже есть. */
  private async ensureCursor(db: any, tenantId: string): Promise<number> {
    let cur = Number(await this.getSetting(this.CURSOR_KEY) || '0');
    if (!cur) {
      const kmax = await this.prisma.payment.aggregate({ where: { tenantId }, _max: { paidAt: true } });
      const [rowsInit] = await db.query('SELECT COALESCE(MAX(id),0) AS id FROM payments WHERE created_at <= ?', [kmax._max.paidAt || new Date(0)]);
      cur = Number((rowsInit as any[])[0]?.id || 0);
      await this.setSetting(this.CURSOR_KEY, String(cur));
      this.log.log(`sync: инициализирован курсор платежей = ${cur}`);
    }
    return cur;
  }
}
