import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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

  // живые серверы внешнего бэкенда (cdn_api) — показать в разделе Серверы
  @Get('nodes')
  async nodes() {
    return { enabled: this.bridge.enabled, nodes: await this.bridge.onlineNodes() };
  }

  // топ по трафику (для страницы Трафик)
  @Get('traffic-top')
  async trafficTop() {
    return { enabled: this.bridge.enabled, top: await this.bridge.trafficTop(50) };
  }

  // управление живыми серверами внешнего бэкенда
  @Patch('nodes/:idx')
  patchNode(@Param('idx') idx: string, @Body() body: { remark?: string; hidden?: boolean }) {
    return this.bridge.patchNode(Number(idx), body);
  }
  @Post('nodes/reorder')
  reorderNodes(@Body('order') order: number[]) {
    return this.bridge.reorderNodes(order);
  }
}
