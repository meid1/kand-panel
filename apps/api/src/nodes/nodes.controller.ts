import {
  Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NodesService } from './nodes.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';

// Всё под JWT админки. Ноды видит и правит только владелец панели.
@UseGuards(JwtAuthGuard)
@Controller('nodes')
export class NodesController {
  constructor(private nodes: NodesService) {}

  @Post()
  create(@Body() dto: CreateNodeDto) {
    return this.nodes.create(dto); // возвращает { node, install: "команда" }
  }

  @Get()
  list(@Query('tenantId') tenantId?: string) {
    return this.nodes.findAll(tenantId);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.nodes.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNodeDto) {
    return this.nodes.update(id, dto);
  }

  @Put('reorder')
  reorder(@Body('ids') ids: string[]) {
    return this.nodes.reorder(ids);
  }

  // текущий xray-конфиг ноды (просмотр/правка)
  @Get(':id/config')
  getConfig(@Param('id') id: string) {
    return this.nodes.getConfig(id);
  }

  // заменить конфиг + запушить на установленный сервер
  @Put(':id/config')
  setConfig(@Param('id') id: string, @Body('config') config: any) {
    return this.nodes.setConfig(id, config);
  }

  // материалы для РУЧНОЙ установки (без curl|bash)
  @Get(':id/manual')
  manual(@Param('id') id: string) {
    return this.nodes.manual(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.nodes.remove(id);
  }
}
