import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * Запись в БД бота (MySQL vpn_db), когда подписки/бан ведёт внешний бот. Активна
 * ТОЛЬКО если заданы BRIDGE_DB_HOST/USER/PASS/NAME — иначе no-op. Ключ клиента —
 * telegram_id. Продление подписки по формуле бота: expired_date = max(текущий,сейчас)+N дн.
 * Использует mysql2 (грузим лениво, чтобы обычная панель не требовала MySQL).
 */
@Injectable()
export class VpnDbService implements OnModuleDestroy {
  private readonly log = new Logger(VpnDbService.name);
  private pool: any = null;

  get enabled() {
    return !!(process.env.BRIDGE_DB_HOST && process.env.BRIDGE_DB_USER && process.env.BRIDGE_DB_NAME);
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

  private async userId(db: any, tgId: string | number): Promise<number | null> {
    const [rows] = await db.query('SELECT id FROM users WHERE telegram_id=? LIMIT 1', [String(tgId)]);
    return rows?.[0]?.id ?? null;
  }

  /** Продлить/списать дни подписки. Возвращает новый expired_date (ISO) или null (no-op/нет юзера). */
  async grantDays(tgId: string | number, days: number): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const db = await this.db();
      const uid = await this.userId(db, tgId);
      if (!uid) { this.log.warn(`vpn_db: юзер telegram_id=${tgId} не найден`); return null; }
      const [subs] = await db.query(
        'SELECT id FROM subscriptions WHERE user_id=? ORDER BY expired_date DESC LIMIT 1', [uid]);
      if (subs?.[0]) {
        await db.query(
          "UPDATE subscriptions SET expired_date = DATE_ADD(GREATEST(COALESCE(expired_date, NOW()), NOW()), INTERVAL ? DAY), status='active' WHERE id=?",
          [Math.round(days), subs[0].id]);
      } else {
        await db.query(
          "INSERT INTO subscriptions (user_id, tariff_id, start_date, expired_date, status) VALUES (?, NULL, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), 'active')",
          [uid, Math.round(days)]);
      }
      const [chk] = await db.query(
        'SELECT expired_date FROM subscriptions WHERE user_id=? ORDER BY expired_date DESC LIMIT 1', [uid]);
      return chk?.[0]?.expired_date ? new Date(chk[0].expired_date).toISOString() : null;
    } catch (e: any) { this.log.warn(`vpn_db grantDays ${tgId}: ${e.message || e}`); return null; }
  }

  /** Бан/разбан в БД бота. */
  async setBanned(tgId: string | number, banned: boolean) {
    if (!this.enabled) return;
    try {
      const db = await this.db();
      await db.query('UPDATE users SET is_banned=? WHERE telegram_id=?', [banned ? 1 : 0, String(tgId)]);
    } catch (e: any) { this.log.warn(`vpn_db setBanned ${tgId}: ${e.message || e}`); }
  }
}
