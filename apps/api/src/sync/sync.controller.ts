import { Controller, Get, Post, UseGuards } from '@nestjs/common';
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

  // ручной запуск синхронизации из панели
  @Post('catalyc')
  run() {
    return this.sync.syncOnce();
  }
}
