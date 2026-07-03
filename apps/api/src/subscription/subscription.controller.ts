import { Controller, Delete, Get, Header, Headers, Param, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';

// Публичный (без JWT): клиент открывает /sub/<token> в приложении.
// Ужесточённый лимит на IP — защита от скрапинга/перебора токенов (клиент
// обновляет подписку раз в ~12ч, 30/мин с запасом).
@Throttle({ default: { limit: 30, ttl: 60000 } })
@Controller('sub')
export class SubscriptionController {
  constructor(private sub: SubscriptionService) {}

  @Get(':token')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async get(@Param('token') token: string, @Res({ passthrough: true }) res: Response, @Headers() h: any) {
    // HWID-лимит устройств (заголовки шлют Happ/v2rayTun); бросит 403 при превышении
    await this.sub.hwidCheck(token, h['x-hwid'], h['x-device-os'], h['x-device-model']);
    const { body, expireUnix } = await this.sub.build(token);
    // заголовок для VPN-клиентов (срок подписки)
    const info = ['upload=0', 'download=0', 'total=0'];
    if (expireUnix) info.push(`expire=${expireUnix}`);
    res.setHeader('subscription-userinfo', info.join('; '));
    res.setHeader('profile-update-interval', '12');
    return body;
  }

  // Полный xray-конфиг с умной маршрутизацией (RU-direct, YouTube-РФ).
  @Get(':token/xray')
  @Header('Content-Type', 'application/json; charset=utf-8')
  xray(@Param('token') token: string) {
    return this.sub.buildXrayClientConfig(token);
  }
}

// HWID-устройства клиента (админка): просмотр/удаление.
@UseGuards(JwtAuthGuard)
@Controller('users')
export class HwidController {
  constructor(private sub: SubscriptionService) {}

  @Get(':id/hwids')
  list(@Param('id') id: string) { return this.sub.hwids(id); }

  @Delete(':id/hwids/:hwidId')
  remove(@Param('id') id: string, @Param('hwidId') hwidId: string) { return this.sub.removeHwid(id, hwidId); }
}

// Короткий ТВ-роут: /t/<код> (легко ввести пультом на телевизоре).
@Throttle({ default: { limit: 30, ttl: 60000 } })
@Controller('t')
export class TvController {
  constructor(private sub: SubscriptionService) {}

  @Get(':code')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async get(@Param('code') code: string, @Res({ passthrough: true }) res: Response) {
    const token = await this.sub.tvToken(code);
    const { body, expireUnix } = await this.sub.build(token);
    const info = ['upload=0', 'download=0', 'total=0'];
    if (expireUnix) info.push(`expire=${expireUnix}`);
    res.setHeader('subscription-userinfo', info.join('; '));
    res.setHeader('profile-update-interval', '12');
    return body;
  }
}
