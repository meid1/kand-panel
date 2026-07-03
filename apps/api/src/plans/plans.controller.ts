import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private plans: PlansService) {}

  // публично: активные тарифы (для бота/кабинета)
  @Get()
  list(@Query('tenantId') tenantId?: string) { return this.plans.list(tenantId); }

  @UseGuards(JwtAuthGuard) @Get('all')
  all() { return this.plans.all(); }
  @UseGuards(JwtAuthGuard) @Post()
  create(@Body() dto: any) { return this.plans.create(dto); }
  @UseGuards(JwtAuthGuard) @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any) { return this.plans.update(id, dto); }
  @UseGuards(JwtAuthGuard) @Delete(':id')
  remove(@Param('id') id: string) { return this.plans.remove(id); }
}
