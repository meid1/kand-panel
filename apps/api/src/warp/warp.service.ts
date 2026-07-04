import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { generateKeyPairSync } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Постоянный WireGuard-peer Cloudflare.
const WARP_PEER_PUBKEY = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=';
const BASE = 'https://api.cloudflareclient.com/v0a2158';
// Пул IPv4-endpoint'ов Cloudflare WARP — для ротации/failover, если один притормозит.
export const WARP_ENDPOINTS = ['162.159.192.1:2408', '162.159.195.1:2408', '188.114.98.224:2408', '188.114.99.224:2408'];

// ИИ/LLM-домены → WARP (чистый IP Cloudflare, без капчи/блока). Только явные домены.
export const AI_DOMAINS = [
  'domain:openai.com', 'domain:chatgpt.com', 'domain:oaistatic.com', 'domain:oaiusercontent.com',
  'domain:anthropic.com', 'domain:claude.ai', 'domain:x.ai', 'domain:grok.com',
  'domain:perplexity.ai', 'domain:gemini.google.com', 'domain:bard.google.com',
  'domain:ai.google.dev', 'domain:aistudio.google.com', 'domain:makersuite.google.com',
  'domain:generativelanguage.googleapis.com',
];

/**
 * WARP (Cloudflare WireGuard): регистрирует свежий бесплатный аккаунт и отдаёт
 * приватный WG-ключ для xray-wireguard-outbound. ИИ-домены роутятся через WARP,
 * чтобы нейросети выходили с чистого IP (нода — дата-центровый IP → капча/блок).
 */
@Injectable()
export class WarpService {
  private readonly log = new Logger(WarpService.name);
  constructor(private prisma: PrismaService) {}

  private async setting(key: string): Promise<string> {
    return (await this.prisma.setting.findUnique({ where: { key } }))?.value || '';
  }
  private async put(key: string, value: string) {
    await this.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  /** Текущий endpoint WARP: настройка warp.endpoint (если валидна) иначе первый из пула. */
  async endpoint(): Promise<string> {
    const s = (await this.setting('warp.endpoint')).trim();
    return /^[\d.]+:\d+$/.test(s) ? s : WARP_ENDPOINTS[0];
  }
  /** Следующий endpoint из пула (для ротации при сбое). */
  nextEndpoint(current?: string): string {
    const i = WARP_ENDPOINTS.indexOf((current || '').trim());
    return WARP_ENDPOINTS[(i + 1) % WARP_ENDPOINTS.length];
  }
  /** Конфиг WARP для админки. */
  async config() {
    return { endpoint: await this.endpoint(), endpoints: WARP_ENDPOINTS, hasLicense: !!(await this.setting('warp.plus_license')) };
  }
  async setConfig(dto: { endpoint?: string; license?: string }) {
    if (dto.endpoint != null) { if (dto.endpoint && !/^[\d.]+:\d+$/.test(dto.endpoint)) throw new BadRequestException('endpoint: формат IP:порт'); await this.put('warp.endpoint', dto.endpoint || WARP_ENDPOINTS[0]); }
    if (dto.license != null) await this.put('warp.plus_license', dto.license.trim());
    return { ok: true };
  }

  /** Зарегистрировать WARP-аккаунт → приватный ключ (base64) или null при сбое. WARP+ если задана лицензия. */
  async register(): Promise<string | null> {
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    const jwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string };
    const privB64 = Buffer.from(jwk.d, 'base64url').toString('base64');
    const pubB64 = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url').toString('base64');
    try {
      const r = await fetch(`${BASE}/reg`, {
        method: 'POST',
        headers: {
          'CF-Client-Version': 'a-6.11-2223', 'Content-Type': 'application/json',
          'User-Agent': 'okhttp/3.12.1', 'Accept': 'application/json',
        },
        body: JSON.stringify({
          key: pubB64, install_id: '', fcm_token: '',
          tos: '2020-01-01T00:00:00.000Z', model: 'PC', serial_number: '', locale: 'en_US',
        }),
      });
      const data: any = await r.json();
      if (!data || !data.config) return null;
      // WARP+ (опц.): апгрейд аккаунта, если задана лицензия — больше скорости на ИИ-трафике.
      const license = (await this.setting('warp.plus_license')).trim();
      if (license && data.id && data.token) {
        try {
          const up = await fetch(`${BASE}/reg/${data.id}/account`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json', 'User-Agent': 'okhttp/3.12.1' },
            body: JSON.stringify({ license }),
          });
          const acc: any = await up.json().catch(() => ({}));
          if (acc?.warp_plus || acc?.account?.warp_plus) this.log.log('WARP+ активирован');
          else this.log.warn('WARP+ лицензия не применилась (проверьте ключ)');
        } catch (e: any) { this.log.warn(`WARP+ apply: ${e.message || e}`); }
      }
      return privB64;
    } catch (e: any) {
      this.log.warn(`WARP регистрация: ${e.message || e}`);
      return null;
    }
  }

  /** xray wireguard-outbound tag=warp (endpoint — из настройки/пула). */
  outbound(secretKey: string, endpoint?: string) {
    return {
      protocol: 'wireguard', tag: 'warp',
      settings: {
        secretKey, address: ['172.16.0.2/32'], mtu: 1280,
        peers: [{ publicKey: WARP_PEER_PUBKEY, endpoint: endpoint || WARP_ENDPOINTS[0], allowedIPs: ['0.0.0.0/0'] }],
      },
    };
  }

  /** Правило: ИИ-домены → warp. */
  aiRule() { return { type: 'field', domain: [...AI_DOMAINS], outboundTag: 'warp' }; }
}
