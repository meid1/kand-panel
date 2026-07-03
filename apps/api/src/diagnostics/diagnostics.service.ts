import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReconcileService } from '../reconcile/reconcile.service';

/**
 * Самодиагностика клиента: проверяет всё, что влияет на работу VPN, и показывает
 * КОНКРЕТНУЮ проблему + кнопку «Починить» (перераскатка ключей по нодам). Так
 * владелец/клиент чинит доступ в один клик, без ручного ковыряния.
 */
@Injectable()
export class DiagnosticsService {
  constructor(private prisma: PrismaService, private reconcile: ReconcileService) {}

  async forUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }, include: { devices: true, bypass: true },
    });
    if (!user) throw new NotFoundException('пользователь не найден');
    const now = Date.now();

    const subActive = !user.isBlocked && (!user.expireAt || user.expireAt.getTime() > now);
    const deviceIds = user.devices.map((d) => d.id);
    const activeNodes = await this.prisma.node.findMany({ where: { isActive: true } });
    const onlineNodes = activeNodes.filter((n) => n.online).length;
    const ks = deviceIds.length
      ? await this.prisma.keySyncStatus.findMany({ where: { deviceId: { in: deviceIds } } })
      : [];
    const syncedOk = ks.length > 0 && ks.every((k) => k.synced);

    const checks = [
      { name: 'Подписка активна', ok: subActive,
        detail: user.isBlocked ? 'заблокирован' : (user.expireAt ? `до ${user.expireAt.toISOString().slice(0, 10)}` : 'бессрочно') },
      { name: 'Есть устройства', ok: user.devices.length > 0, detail: `${user.devices.length} шт.` },
      { name: 'Лимит обхода не исчерпан', ok: !user.bypass?.isSuspended, detail: user.bypass?.isSuspended ? 'исчерпан' : 'ок' },
      { name: 'Есть онлайн-ноды', ok: onlineNodes > 0, detail: `${onlineNodes}/${activeNodes.length}` },
      { name: 'Ключи разложены по нодам', ok: syncedOk,
        detail: ks.length ? `${ks.filter((k) => k.synced).length}/${ks.length}` : 'нет данных (нужен reconcile)' },
    ];
    const ok = checks.every((c) => c.ok);
    // чинибельно, если проблема в устройствах/keysync (reconcile поможет)
    const canFix = !ok && (subActive) && (user.devices.length > 0);
    return { ok, checks, canFix, hint: ok ? 'Всё в порядке' : this.hint(checks) };
  }

  private hint(checks: any[]): string {
    const bad = checks.find((c) => !c.ok);
    if (!bad) return '';
    if (bad.name.includes('Подписка')) return 'Продлите/разблокируйте подписку.';
    if (bad.name.includes('устройства')) return 'Добавьте устройство.';
    if (bad.name.includes('обхода')) return 'Докупите ГБ обхода или сбросьте счётчик.';
    if (bad.name.includes('ноды')) return 'Ноды офлайн — проверьте серверы.';
    return 'Нажмите «Починить» — переразложим ключи по нодам.';
  }

  /** «Починить»: перераскатка ключей по нодам (лечит рассинхрон keysync). */
  async fix(userId: string) {
    await this.forUser(userId); // проверка существования
    const res = await this.reconcile.reconcileAll();
    const okNodes = res.filter((r: any) => r.ok).length;
    return { ok: true, reconciled: `${okNodes}/${res.length} нод`, detail: res };
  }
}
