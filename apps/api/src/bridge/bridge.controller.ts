import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BridgeService } from './bridge.service';

@UseGuards(JwtAuthGuard)
@Controller('bridge')
export class BridgeController {
  constructor(private bridge: BridgeService) {}

  // живой статус внешнего бэкенда (онлайн/трафик) — для дашборда
  @Get('status')
  async status() {
    return { enabled: this.bridge.enabled, status: await this.bridge.status() };
  }
}
