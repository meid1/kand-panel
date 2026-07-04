import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TicketsService } from './tickets.service';

@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Get()
  list(@Query('status') status?: string, @Query('tenantId') tenantId?: string) {
    return this.tickets.list(status, tenantId);
  }

  @Get('count')
  count(@Query('tenantId') tenantId?: string) {
    return this.tickets.openCount(tenantId);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.tickets.one(id);
  }

  @Post(':id/reply')
  reply(@Param('id') id: string, @Body('text') text: string) {
    return this.tickets.reply(id, text);
  }

  @Post(':id/status')
  status(@Param('id') id: string, @Body('status') status: string) {
    return this.tickets.setStatus(id, status);
  }
}
