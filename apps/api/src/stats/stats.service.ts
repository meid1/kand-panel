import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';
import { BypassService } from '../bypass/bypass.service';

const AGENT_PORT = 8443;

/**
 * Сбор трафика с нод (дельта-режим) и запись в BypassUsage. Агент считает трафик
 * по клиентам (email = device.id) и обнуляет счётчики при reset=1 — панель
 * СУММИРУЕТ дельты в BypassUsage.totalBytes. Так учёт не зависит от рестартов xray
 * и не двоится между нодами (клиент один и тот же uuid на всех — суммируем).
 *
 * Раз в 5 минут автоматически (@Interval). Также доступно вручную через контроллер.
 */
@Injectable()
export class StatsService {
  private readonly log = new Logger(StatsService.name);
  private running = false;
  constructor(
    private prisma: PrismaService,
    private agent: NodeAgentClient,
    private bypass: BypassService,
  ) {}

  @Interval(300_000)
  async scheduled() {
    if (this.running) return; // не наслаивать циклы
    await this.collectAll().catch((e) => this.log.warn(`сбор трафика: ${e.message || e}`));
  }

  /** Обойти активные ноды, забрать дельты трафика, прибавить в BypassUsage. */
  async collectAll() {
    this.running = true;
    try {
      const nodes = await this.prisma.node.findMany({ where: { isActive: true } });
      // email(device.id) → суммарная дельта байт со всех нод за цикл
      const delta = new Map<string, bigint>();
      for (const n of nodes) {
        let res: any;
        try {
          res = await this.agent.stats(n.ip, AGENT_PORT, true);
        } catch (e: any) {
          this.log.warn(`нода ${n.label}: ${e.message || e}`);
          continue;
        }
        const users = res?.users || {};
        for (const [email, st] of Object.entries<any>(users)) {
          const add = BigInt(st.up || 0) + BigInt(st.down || 0);
          delta.set(email, (delta.get(email) || 0n) + add);
        }
      }
      let updated = 0;
      for (const [deviceId, bytes] of delta) {
        if (bytes <= 0n) continue;
        const dev = await this.prisma.device.findUnique({ where: { id: deviceId } });
        if (!dev) continue;
        await this.prisma.bypassUsage.upsert({
          where: { userId: dev.userId },
          update: { totalBytes: { increment: bytes } },
          create: { userId: dev.userId, totalBytes: bytes },
        });
        updated++;
      }
      if (updated) this.log.log(`трафик учтён: ${updated} юзеров`);
      await this.bypass.checkAll(); // пересчёт лимитов обхода + месячный сброс
      return { ok: true, users: updated };
    } finally {
      this.running = false;
    }
  }
}
