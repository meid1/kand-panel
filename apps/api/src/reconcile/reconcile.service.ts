import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NodeAgentClient, AgentUser } from '../nodes-agent/node-agent.client';

// Порт агента ноды (см. agent/main.go AGENT_LISTEN=:8443). Фиксирован по всему флоту.
const AGENT_PORT = 8443;
const VISION = 'xtls-rprx-vision';

/**
 * Реконсайл ключей: вычисляет desired-набор пользователей для каждой активной
 * ноды и приводит ноду к нему через агент (mTLS). Идемпотентно — можно гонять
 * по таймеру. Изоляция: BYON-нода тенанта получает ТОЛЬКО клиентов своего тенанта;
 * платформенная (tenantId=null) — всех.
 *
 * Статус раскатки пишем в KeySyncStatus по (device, node): synced/ошибка. Это
 * ЧЕСТНЫЙ статус — зелёным помечаем только реально применённые ключи, не «до».
 */
@Injectable()
export class ReconcileService {
  private readonly log = new Logger(ReconcileService.name);
  constructor(private prisma: PrismaService, private agent: NodeAgentClient) {}

  private async nowMs(): Promise<number> {
    const r = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT now() as now`;
    return new Date(r[0].now).getTime();
  }

  /** Действующие устройства (не заблокирован, подписка не истекла, лимит обхода не исчерпан). */
  private async activeDevices(now: number) {
    const devices = await this.prisma.device.findMany({
      include: { user: { select: { id: true, isBlocked: true, expireAt: true, tenantId: true } } },
    });
    // исчерпавшие лимит обхода — ключи снимаем с нод (реальный стоп обхода)
    const suspended = new Set(
      (await this.prisma.bypassUsage.findMany({ where: { isSuspended: true }, select: { userId: true } }))
        .map((b) => b.userId),
    );
    return devices.filter(
      (d) => !d.user.isBlocked &&
        (!d.user.expireAt || d.user.expireAt.getTime() > now) &&
        !suspended.has(d.user.id),
    );
  }

  /** Реконсайл ОДНОЙ ноды. Возвращает {ok, added, removed} или {ok:false,error}. */
  async reconcileNode(nodeId: string) {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
    if (!node || !node.isActive) return { ok: false, error: 'нода не активна' };

    const now = await this.nowMs();
    let devices = await this.activeDevices(now);
    if (node.tenantId) devices = devices.filter((d) => d.user.tenantId === node.tenantId);

    const users: AgentUser[] = devices.map((d) => ({
      uuid: d.vlessUuid, email: d.id, flow: VISION,
    }));

    try {
      const res = await this.agent.apply(node.ip, AGENT_PORT, users);
      // помечаем keysync зелёным ТОЛЬКО после успешного apply
      await this.markSynced(node.id, devices.map((d) => d.id), true);
      await this.prisma.node.update({
        where: { id: node.id }, data: { online: true, lastCheck: new Date(now) },
      });
      return { ok: true, ...res };
    } catch (e: any) {
      await this.markSynced(node.id, devices.map((d) => d.id), false, String(e.message || e));
      await this.prisma.node.update({
        where: { id: node.id }, data: { online: false, lastCheck: new Date(now) },
      });
      this.log.warn(`реконсайл ноды ${node.label}: ${e.message || e}`);
      return { ok: false, error: String(e.message || e) };
    }
  }

  private async markSynced(nodeId: string, deviceIds: string[], synced: boolean, err?: string) {
    const at = new Date(await this.nowMs());
    for (const deviceId of deviceIds) {
      await this.prisma.keySyncStatus.upsert({
        where: { deviceId_nodeId: { deviceId, nodeId } },
        update: { synced, lastAttempt: at, lastError: synced ? null : (err ?? null) },
        create: { deviceId, nodeId, synced, lastAttempt: at, lastError: err ?? null },
      });
    }
  }

  /** Реконсайл всего флота (все активные ноды). */
  async reconcileAll() {
    const nodes = await this.prisma.node.findMany({ where: { isActive: true } });
    const results = [];
    for (const n of nodes) results.push({ node: n.label, ...(await this.reconcileNode(n.id)) });
    return results;
  }
}
