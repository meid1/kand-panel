import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { join } from 'path';

// Корень репозитория панели (где лежат install-node.sh и agent/vpanel-agent).
const ROOT = process.env.VPANEL_ROOT || '/opt/vpanel';

/**
 * Публичная раздача установочных артефактов ноды: сам скрипт и бинарь агента.
 * Секретов тут НЕТ (ключи ноды передаются в per-node команде через env NODE_BUNDLE,
 * а не в скрипте). Агент — опенсорс, бинарь публичный.
 * Роуты вне префикса /api (см. main.ts exclude), т.к. так их зовёт install-команда.
 * Лимит на IP — защита от абуза скачивания бинаря (легитимные установки редки).
 */
@Throttle({ default: { limit: 20, ttl: 60000 } })
@Controller()
export class InstallController {
  @Get('install-node.sh')
  script(@Res() res: Response) {
    const p = join(ROOT, 'install-node.sh');
    if (!existsSync(p)) throw new NotFoundException('install-node.sh не найден');
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    createReadStream(p).pipe(res);
  }

  @Get('install/vpanel-agent')
  agent(@Res() res: Response) {
    const p = join(ROOT, 'agent', 'vpanel-agent');
    if (!existsSync(p)) {
      throw new NotFoundException(
        'бинарь агента не собран — выполни: cd ' + ROOT + '/agent && go build -o vpanel-agent',
      );
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(statSync(p).size));
    res.setHeader('Content-Disposition', 'attachment; filename=vpanel-agent');
    createReadStream(p).pipe(res);
  }
}
