import { Injectable, Logger } from '@nestjs/common';

/**
 * Мост к внешнему key-бэкенду (NRx-совместимый /v1 API). Когда ключи/подписку
 * обслуживает внешняя система (напр. свой CDN-биллинг), админ-действия панели
 * пробрасываются туда, чтобы реально влиять на клиента. Активен ТОЛЬКО если заданы
 * BRIDGE_API_URL + BRIDGE_API_KEY — иначе полностью no-op (обычная панель не затронута).
 * email клиента = externalId (напр. "cat_<tgid>").
 */
@Injectable()
export class BridgeService {
  private readonly log = new Logger(BridgeService.name);
  private url = (process.env.BRIDGE_API_URL || '').replace(/\/+$/, '');
  private key = process.env.BRIDGE_API_KEY || '';

  get enabled() { return !!(this.url && this.key); }

  private async call(method: string, path: string, body?: any): Promise<any> {
    const r = await fetch(this.url + path, {
      method,
      headers: { 'X-API-Key': this.key, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw new Error(`bridge ${method} ${path} → HTTP ${r.status}`);
    return r.json().catch(() => ({}));
  }

  /** Тихая обёртка: ошибки логируем, но не роняем админ-действие панели. */
  private async safe(fn: () => Promise<any>, ctx: string) {
    if (!this.enabled) return { skipped: true };
    try { await fn(); return { ok: true }; }
    catch (e: any) { this.log.warn(`мост ${ctx}: ${e.message || e}`); return { ok: false, error: String(e.message || e) }; }
  }

  async setEnabled(email: string, on: boolean) {
    return this.safe(() => this.call('POST', `/v1/clients/${on ? 'on' : 'off'}-by-email/${encodeURIComponent(email)}`), `${on ? 'on' : 'off'} ${email}`);
  }
  async patch(email: string, fields: Record<string, any>) {
    return this.safe(() => this.call('PATCH', `/v1/clients/by-email/${encodeURIComponent(email)}`, fields), `patch ${email}`);
  }
  setBypassGb(email: string, gb: number) { return this.patch(email, { totalGB: gb }); }
  setHasBypass(email: string, has: boolean) { return this.patch(email, { hasBypass: has }); }
  resetTraffic(email: string) { return this.patch(email, { resetTraffic: true }); }

  /** Относительная докупка/списание лимита обхода: читаем текущий cap в бэкенде и меняем (без расхождений с его метрингом). */
  async adjustBypassGb(email: string, deltaGb: number) {
    return this.safe(async () => {
      const c = await this.call('GET', `/v1/clients/by-email/${encodeURIComponent(email)}`);
      const cur = Number(c?.data?.totalGB || 0);
      const next = Math.max(0, cur + deltaGb);
      await this.call('PATCH', `/v1/clients/by-email/${encodeURIComponent(email)}`, { totalGB: next });
    }, `adjustGb ${email} ${deltaGb}`);
  }
  deleteKey(email: string) {
    return this.safe(() => this.call('DELETE', `/v1/clients/by-email/${encodeURIComponent(email)}`), `delete ${email}`);
  }
  /** Создать ключ во внешнем бэкенде (uuid/sub_id генерятся там). email = externalId. */
  createKey(email: string, tgId?: string) {
    return this.safe(() => this.call('POST', '/v1/clients', { email, tgId: tgId ? String(tgId) : '', hasBypass: true }), `create ${email}`);
  }
}
