import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import * as https from 'https';
import { CryptoService } from '../crypto/crypto.service';

export interface AgentUser { uuid: string; email: string; flow?: string }

/**
 * Клиент панели к агенту ноды (agent/server.go). Транспорт — mTLS (клиентский серт
 * панели, подписанный нашей CA). Поверх — Bearer JWT (HS256, общий секрет ноды).
 * Никакого SSH: только HTTPS на порт агента.
 */
@Injectable()
export class NodeAgentClient {
  private readonly log = new Logger(NodeAgentClient.name);
  constructor(private crypto: CryptoService) {}

  // Компактный HS256-JWT (без внешних зависимостей) — как ждёт agent/server.go.
  private async bearer(): Promise<string> {
    const secret = await this.crypto.getNodeJwtSecret();
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    // exp через БД-время не гоняем: агент проверяет только подпись/валидность,
    // короткий срок задаём фиксированной дельтой от iat не нужен → без exp.
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ sub: 'vpanel', iss: 'vpanel' });
    const sig = createHmac('sha256', secret)
      .update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
  }

  private async request(
    ip: string, port: number, method: string, path: string, body?: object,
  ): Promise<any> {
    const creds = await this.crypto.getPanelClientCreds();
    const token = await this.bearer();
    const payload = body ? JSON.stringify(body) : undefined;
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: ip, port, method, path,
          cert: creds.certPem, key: creds.keyPem, ca: creds.caPem,
          // серверный серт ноды подписан нашей CA; SAN = IP → проверяем строго
          servername: ip,
          rejectUnauthorized: true,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          timeout: 15000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if ((res.statusCode || 500) >= 400) {
              return reject(new Error(`агент ${ip}: HTTP ${res.statusCode} ${data}`));
            }
            try { resolve(data ? JSON.parse(data) : {}); }
            catch { resolve({ raw: data }); }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(`агент ${ip}: таймаут`)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** POST /apply — привести ноду к desired-набору пользователей. */
  apply(ip: string, port: number, users: AgentUser[]) {
    return this.request(ip, port, 'POST', '/apply', { users });
  }

  /** GET /state — версия/здоровье/кол-во юзеров на ноде. */
  state(ip: string, port: number) {
    return this.request(ip, port, 'GET', '/state');
  }

  /** GET /health */
  health(ip: string, port: number) {
    return this.request(ip, port, 'GET', '/health');
  }

  /** GET /stats?reset=1 — трафик по клиентам (дельта). reset обнуляет счётчики. */
  stats(ip: string, port: number, reset = true) {
    return this.request(ip, port, 'GET', `/stats?reset=${reset ? 1 : 0}`);
  }
}
