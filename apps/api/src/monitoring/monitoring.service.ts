import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';

const AGENT_PORT = 8443;
const DAY = 86400_000;

/**
 * Мониторинг: (1) здоровье нод — алерт владельцу при уходе ноды в офлайн/возврате;
 * (2) напоминания об истечении подписки клиентам (за 3 дня, за 1 день, по факту).
 * Уведомления — через Telegram-бота (настройка bot.token) владельцу (owner.tg_id)
 * и клиентам. Дедуп: ноды по флагу online, напоминания по remindStage.
 */
@Injectable()
export class MonitoringService {
  private readonly log = new Logger(MonitoringService.name);
  constructor(private prisma: PrismaService, private agent: NodeAgentClient) {}

  private async setting(key: string): Promise<string> {
    return (await this.prisma.setting.findUnique({ where: { key } }))?.value || '';
  }
  private async botToken() { return (await this.setting('bot.token')) || process.env.BOT_TOKEN || ''; }

  private async notify(token: string, chatId: string | number, text: string) {
    if (!token) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
    } catch { /* сеть */ }
  }

  // ── ноды: алерт владельцу при смене online↔offline ────────────────────────
  @Interval(300_000)
  async checkNodes() {
    const token = await this.botToken();
    const owner = await this.setting('owner.tg_id');
    const nodes = await this.prisma.node.findMany({ where: { isActive: true } });
    for (const n of nodes) {
      let healthy = false;
      try { await this.agent.health(n.ip, AGENT_PORT); healthy = true; } catch { healthy = false; }
      if (healthy !== n.online) {
        await this.prisma.node.update({ where: { id: n.id }, data: { online: healthy, lastCheck: new Date() } });
        if (owner && token) {
          await this.notify(token, owner, healthy
            ? `✅ Нода «${n.label}» (${n.ip}) снова онлайн.`
            : `⚠️ Нода «${n.label}» (${n.ip}) НЕ отвечает (офлайн). Проверьте сервер.`);
        }
      }
    }
  }

  // ── напоминания об истечении подписки ─────────────────────────────────────
  @Interval(3600_000)
  async checkExpiry() {
    const token = await this.botToken();
    if (!token) return;
    const brandRow = await this.setting('brand'); const brand = brandRow || 'VPN';
    const now = Date.now();
    const users = await this.prisma.user.findMany({
      where: { isBlocked: false, expireAt: { not: null } },
      select: { id: true, tgId: true, expireAt: true, remindStage: true },
    });
    for (const u of users) {
      if (!u.tgId || u.tgId <= 0n) continue;
      const daysLeft = Math.ceil((u.expireAt!.getTime() - now) / DAY);
      let stage = 0, text = '';
      // winback: истёк ≥3 дней назад и ещё не возвращали (стадия 4)
      if (daysLeft <= -3 && u.remindStage < 4) { stage = 4; text = `Скучаем! 💙 Возвращайся в ${brand} — продли подписку в боте и снова пользуйся VPN. Может, дадим бонус 🎁`; }
      else if (daysLeft < 0 && u.remindStage < 3) { stage = 3; text = `Ваша подписка ${brand} истекла. Продлите доступ в боте, чтобы снова пользоваться VPN.`; }
      else if (daysLeft <= 1 && daysLeft >= 0 && u.remindStage < 2) { stage = 2; text = `⏳ Подписка ${brand} истекает ${daysLeft === 0 ? 'сегодня' : 'завтра'}. Продлите, чтобы не потерять доступ.`; }
      else if (daysLeft <= 3 && daysLeft > 1 && u.remindStage < 1) { stage = 1; text = `🔔 Подписка ${brand} истекает через ${daysLeft} дн. Не забудьте продлить.`; }
      if (stage) {
        await this.notify(token, u.tgId.toString(), text);
        await this.prisma.user.update({ where: { id: u.id }, data: { remindStage: stage } });
      }
    }
  }

  /** Ручной прогон (для теста/кнопки). */
  async runNow() { await this.checkNodes(); await this.checkExpiry(); return { ok: true }; }
}
