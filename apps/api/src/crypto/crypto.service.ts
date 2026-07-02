import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { generateKeyPairSync, randomBytes } from 'crypto';
import * as forge from 'node-forge';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PKI/CA-сервис панели.
 *
 * Одна самоподписанная CA хранится в таблице Setting (создаётся при первом
 * старте). Всё общение панель↔нода идёт по mTLS:
 *  - у ноды свой серверный серт (выпускается тут, кладётся на ноду при установке);
 *  - у панели свой клиентский серт (тоже подписан нашей CA) — им она стучится в агенты;
 *  - агент принимает ТОЛЬКО клиента с сертом от нашей CA (см. agent/server.go).
 * Второй слой — Bearer JWT (общий секрет ноды). mTLS — основной барьер.
 *
 * Приватные ключи (CA, panel-client) не покидают БД панели. В bundle ноды
 * уходит только её серверный серт+ключ, публичный CA-серт и JWT-секрет.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly log = new Logger(CryptoService.name);

  // ключи в таблице Setting
  private static K = {
    caCert: 'pki.ca_cert_pem',
    caKey: 'pki.ca_key_pem',
    panelCert: 'pki.panel_client_cert_pem',
    panelKey: 'pki.panel_client_key_pem',
    nodeJwt: 'pki.node_jwt_secret',
  };

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureCa();
  }

  // ── низкоуровневый доступ к Setting ──────────────────────────────────────
  private async get(key: string): Promise<string | null> {
    const r = await this.prisma.setting.findUnique({ where: { key } });
    return r?.value ?? null;
  }
  private async set(key: string, value: string) {
    await this.prisma.setting.upsert({
      where: { key }, update: { value }, create: { key, value },
    });
  }

  /** Создаёт CA + клиентский серт панели + JWT-секрет ноды, если их ещё нет. */
  async ensureCa(): Promise<void> {
    if (await this.get(CryptoService.K.caCert)) return;
    this.log.log('PKI не найдена — генерирую CA, клиентский серт панели, JWT-секрет');

    // 1) корневой CA (10 лет)
    const caKeys = forge.pki.rsa.generateKeyPair(2048);
    const caCert = forge.pki.createCertificate();
    caCert.publicKey = caKeys.publicKey;
    caCert.serialNumber = this.serial();
    caCert.validity.notBefore = new Date(0); // избегаем Date.now — стабильно
    caCert.validity.notAfter = new Date(0);
    caCert.validity.notBefore.setFullYear(2025, 0, 1);
    caCert.validity.notAfter.setFullYear(2035, 0, 1);
    const caAttrs = [{ name: 'commonName', value: 'vpanel-ca' }];
    caCert.setSubject(caAttrs);
    caCert.setIssuer(caAttrs);
    caCert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ]);
    caCert.sign(caKeys.privateKey, forge.md.sha256.create());

    await this.set(CryptoService.K.caCert, forge.pki.certificateToPem(caCert));
    await this.set(CryptoService.K.caKey, forge.pki.privateKeyToPem(caKeys.privateKey));

    // 2) клиентский серт панели (им панель ходит в агенты нод)
    const panel = this.issueLeafWithCa(caCert, caKeys.privateKey, 'vpanel-controller', 'client');
    await this.set(CryptoService.K.panelCert, panel.certPem);
    await this.set(CryptoService.K.panelKey, panel.keyPem);

    // 3) общий JWT-секрет для агентов нод
    await this.set(CryptoService.K.nodeJwt, randomBytes(32).toString('base64'));
    this.log.log('PKI инициализирована');
  }

  private serial(): string {
    // положительный hex-серийник (высокий бит = 0, иначе фордж ругается)
    return '00' + randomBytes(8).toString('hex');
  }

  private async loadCa() {
    const caCertPem = await this.get(CryptoService.K.caCert);
    const caKeyPem = await this.get(CryptoService.K.caKey);
    if (!caCertPem || !caKeyPem) {
      await this.ensureCa();
      return this.loadCa();
    }
    return {
      caCert: forge.pki.certificateFromPem(caCertPem),
      caKey: forge.pki.privateKeyFromPem(caKeyPem),
    };
  }

  /**
   * Выпускает лист-сертификат (server или client), подписанный CA.
   * ВАЖНО: синхронный — использует уже загруженную CA. Для внешних вызовов
   * есть issueNodeCert (async, с SAN на IP/хост ноды).
   */
  private issueLeafWithCa(
    caCert: forge.pki.Certificate,
    caKey: forge.pki.PrivateKey,
    cn: string,
    kind: 'server' | 'client',
    sans: string[] = [],
  ): { certPem: string; keyPem: string } {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.serial();
    cert.validity.notBefore = new Date(0);
    cert.validity.notAfter = new Date(0);
    cert.validity.notBefore.setFullYear(2025, 0, 1);
    cert.validity.notAfter.setFullYear(2035, 0, 1);
    cert.setSubject([{ name: 'commonName', value: cn }]);
    cert.setIssuer(caCert.subject.attributes);

    const exts: any[] = [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      {
        name: 'extKeyUsage',
        serverAuth: kind === 'server',
        clientAuth: kind === 'client',
      },
    ];
    if (sans.length) {
      exts.push({
        name: 'subjectAltName',
        altNames: sans.map((s) =>
          /^\d+\.\d+\.\d+\.\d+$/.test(s)
            ? { type: 7, ip: s } // IP
            : { type: 2, value: s }, // DNS
        ),
      });
    }
    cert.setExtensions(exts);
    cert.sign(caKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());
    return {
      certPem: forge.pki.certificateToPem(cert),
      keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    };
  }

  /** Выпуск серверного сертификата для ноды (SAN = её IP и хост). */
  async issueNodeCert(ip: string, address?: string): Promise<{ certPem: string; keyPem: string }> {
    const { caCert, caKey } = await this.loadCa();
    const sans = [ip, address].filter((s): s is string => !!s);
    return this.issueLeafWithCa(caCert, caKey, `node-${ip}`, 'server', sans);
  }

  /** Публичный CA-серт (для bundle ноды и для mTLS-клиента панели). */
  async getCaCertPem(): Promise<string> {
    return (await this.get(CryptoService.K.caCert)) ?? '';
  }

  /** Клиентские креды панели для mTLS-исходящих в агенты нод. */
  async getPanelClientCreds(): Promise<{ certPem: string; keyPem: string; caPem: string }> {
    return {
      certPem: (await this.get(CryptoService.K.panelCert)) ?? '',
      keyPem: (await this.get(CryptoService.K.panelKey)) ?? '',
      caPem: (await this.get(CryptoService.K.caCert)) ?? '',
    };
  }

  /** Общий JWT-секрет агентов нод (панель подписывает Bearer им). */
  async getNodeJwtSecret(): Promise<string> {
    return (await this.get(CryptoService.K.nodeJwt)) ?? '';
  }
}
