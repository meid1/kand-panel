import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SyncService } from './sync.service';

@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private sync: SyncService) {}

  // текущее состояние синхронизации (для индикатора в панели)
  @Get('status')
  status() {
    return this.sync.status();
  }

  // полный проход (кнопка «Обновить» + фон)
  @Post('catalyc')
  run() {
    return this.sync.syncOnce();
  }

  // лёгкий догон новых оплат/продлений — перед показом дашборда/списков (быстро)
  @Post('light')
  light() {
    return this.sync.syncLight();
  }

  // точечный синк одного клиента по tgId — при открытии его карточки (моментально)
  @Post('user/:tgId')
  user(@Param('tgId') tgId: string) {
    return this.sync.syncUser(tgId);
  }

  // точечный синк по внутреннему id клиента Kand (карточка открывается по id)
  @Post('user-by-id/:id')
  userById(@Param('id') id: string) {
    return this.sync.syncUserById(id);
  }
}
