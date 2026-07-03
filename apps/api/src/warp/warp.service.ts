import { Injectable, Logger } from '@nestjs/common';
import { generateKeyPairSync } from 'crypto';

// Постоянный WireGuard-peer Cloudflare + стабильный IPv4-endpoint.
const WARP_PEER_PUBKEY = 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=';
const WARP_ENDPOINT = '162.159.192.1:2408';
const REG_URL = 'https://api.cloudflareclient.com/v0a2158/reg';

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

  /** Зарегистрировать WARP-аккаунт → приватный ключ (base64) или null при сбое. */
  async register(): Promise<string | null> {
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    const jwk = privateKey.export({ format: 'jwk' }) as { x: string; d: string };
    const privB64 = Buffer.from(jwk.d, 'base64url').toString('base64');
    const pubB64 = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url').toString('base64');
    try {
      const r = await fetch(REG_URL, {
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
      return privB64;
    } catch (e: any) {
      this.log.warn(`WARP регистрация: ${e.message || e}`);
      return null;
    }
  }

  /** xray wireguard-outbound tag=warp. */
  outbound(secretKey: string) {
    return {
      protocol: 'wireguard', tag: 'warp',
      settings: {
        secretKey, address: ['172.16.0.2/32'], mtu: 1280,
        peers: [{ publicKey: WARP_PEER_PUBKEY, endpoint: WARP_ENDPOINT, allowedIPs: ['0.0.0.0/0'] }],
      },
    };
  }

  /** Правило: ИИ-домены → warp. */
  aiRule() { return { type: 'field', domain: [...AI_DOMAINS], outboundTag: 'warp' }; }
}
