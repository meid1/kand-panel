import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';

// BigInt (tgId, ownerTgId) не сериализуется JSON.stringify по умолчанию —
// отдаём его строкой во всех JSON-ответах.
(BigInt.prototype as any).toJSON = function () { return this.toString(); };

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // helmet с ослабленным CSP — админка использует инлайновый скрипт/стили
  app.use(helmet({ contentSecurityPolicy: false }));
  // статика веб-админки (index.html + app.js). no-cache для html/js — чтобы
  // обновления интерфейса сразу доходили до пользователя (иначе телефон кэширует).
  app.useStaticAssets(join(process.env.VPANEL_ROOT || '/opt/vpanel', 'apps/api/public'), {
    setHeaders: (res: any, path: string) => {
      if (/\.(html|js)$/.test(path)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    },
  });
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // публичные роуты без /api: подписка клиента и install-артефакты ноды
  app.setGlobalPrefix('api', {
    exclude: [
      'install-node.sh', 'install/vpanel-agent',
      'sub/:token', 'sub/:token/xray',
      't/:code', // короткий ТВ-роут подписки
      'cabinet/:token', // страница кабинета (данные — под /api/cabinet/:token/data)
    ],
  });
  await app.listen(Number(process.env.API_PORT) || 3000);
}
bootstrap();
