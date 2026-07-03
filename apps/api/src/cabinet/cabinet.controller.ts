import { Body, Controller, Get, Header, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { CabinetService } from './cabinet.service';

const ROOT = process.env.VPANEL_ROOT || '/opt/vpanel';

// Публичный клиентский кабинет. Доступ по личному токену. Rate-limit от перебора.
@Throttle({ default: { limit: 40, ttl: 60000 } })
@Controller()
export class CabinetController {
  constructor(private cabinet: CabinetService) {}

  // страница кабинета (вне /api — см. exclude в main.ts); токен JS читает из URL
  @Get('cabinet/:token')
  page(@Res() res: Response) {
    const p = join(ROOT, 'apps/api/public', 'cabinet.html');
    if (!existsSync(p)) return res.status(404).send('cabinet.html not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    createReadStream(p).pipe(res);
  }

  // данные и продление — под /api
  @Get('cabinet/:token/data')
  data(@Param('token') token: string) {
    return this.cabinet.data(token);
  }

  @Post('cabinet/:token/buy')
  buy(@Param('token') token: string, @Body('provider') provider: string) {
    return this.cabinet.buy(token, provider);
  }

  // QR умной ссылки устройства (SVG) — вне /api, чтобы <img> грузился напрямую
  @Get('cabinet/:token/qr/:idx')
  @Header('Content-Type', 'image/svg+xml')
  async qr(@Param('token') token: string, @Param('idx') idx: string) {
    return this.cabinet.qr(token, Number(idx) || 0);
  }
}
