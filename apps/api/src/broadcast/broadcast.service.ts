import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface BroadcastState {
  running: boolean; total: number; sent: number; failed: number;
  startedAt: number | null; finishedAt: number | null; error?: string;
}

/**
 * Рассылка клиентам через Telegram Bot API. ДВА режима:
 *  - text: обычный текст (sendMessage, parse_mode HTML) — правится в вебе.
 *  - copy: копия сообщения (copyMessage from_chat_id+message_id) — СОХРАНЯЕТ
 *    премиум-эмодзи, медиа, форматирование. Владелец шлёт сообщение боту,
 *    берёт message_id и запускает рассылку — так премиум-эмодзи попадают всем.
 *
 * Идёт В ФОНЕ (2700+ получателей — это ~2 мин), с троттлингом (~25/с) и учётом
 * 429 retry_after. Прогресс виден через status(). Токен бота — из настроек
 * (bot.token) или из тенанта (франшиза). Это надёжная замена веб-рассылки,
 * которая раньше «молча не работала».
 */
@Injectable()
export class BroadcastService {
  private readonly log = new Logger(BroadcastService.name);
  private state: BroadcastState = {
    running: false, total: 0, sent: 0, failed: 0, startedAt: null, finishedAt: null,
  };

  constructor(private prisma: PrismaService) {}

  status() { return this.state; }

  private async botToken(tenantId?: string): Promise<string> {
    if (tenantId) {
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (t?.botToken) return t.botToken;
    }
    const s = await this.prisma.setting.findUnique({ where: { key: 'bot.token' } });
    if (!s?.value) throw new BadRequestException('не задан токен бота (настройки bot.token или у тенанта)');
    return s.value;
  }

  /** Запуск рассылки в фоне. Возвращает {started,total} сразу. */
  async start(opts: {
    text?: string; fromChatId?: number | string; messageId?: number;
    tenantId?: string;
  }) {
    if (this.state.running) throw new BadRequestException('рассылка уже идёт');
    if (!opts.text && !(opts.fromChatId && opts.messageId))
      throw new BadRequestException('нужен text ИЛИ (fromChatId + messageId)');

    const token = await this.botToken(opts.tenantId);
    const users = await this.prisma.user.findMany({
      where: { isBlocked: false, ...(opts.tenantId ? { tenantId: opts.tenantId } : {}) },
      select: { tgId: true },
    });

    this.state = {
      running: true, total: users.length, sent: 0, failed: 0,
      startedAt: Date.now(), finishedAt: null,
    };
    // фон: не блокируем HTTP-ответ
    this.run(token, users.map((u) => u.tgId), opts).catch((e) => {
      this.state.running = false; this.state.error = String(e.message || e);
      this.state.finishedAt = Date.now();
    });
    return { started: true, total: users.length };
  }

  private async run(
    token: string, ids: bigint[],
    opts: { text?: string; fromChatId?: number | string; messageId?: number },
  ) {
    const base = `https://api.telegram.org/bot${token}`;
    for (const tgId of ids) {
      const chatId = tgId.toString();
      const url = opts.text ? `${base}/sendMessage` : `${base}/copyMessage`;
      const body = opts.text
        ? { chat_id: chatId, text: opts.text, parse_mode: 'HTML', disable_web_page_preview: true }
        : { chat_id: chatId, from_chat_id: opts.fromChatId, message_id: opts.messageId };
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (r.status === 429) {
          const j: any = await r.json().catch(() => ({}));
          const wait = (j.parameters?.retry_after || 1) * 1000;
          await this.sleep(wait);
          // один повтор после лимита
          const r2 = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          r2.ok ? this.state.sent++ : this.state.failed++;
        } else if (r.ok) {
          this.state.sent++;
        } else {
          this.state.failed++; // заблокировали бота / удалились — норм
        }
      } catch {
        this.state.failed++;
      }
      await this.sleep(40); // ~25 сообщений/с — в пределах лимитов Telegram
    }
    this.state.running = false;
    this.state.finishedAt = Date.now();
    this.log.log(`рассылка завершена: ${this.state.sent}/${this.state.total} (ошибок ${this.state.failed})`);
  }

  private sleep(ms: number) { return new Promise((res) => setTimeout(res, ms)); }
}
