import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WithdrawalsService } from './withdrawals.service';

@UseGuards(JwtAuthGuard)
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private wd: WithdrawalsService) {}
  @Get() list(@Query('status') status?: string) { return this.wd.list(status); }
  @Get('count') count() { return this.wd.pendingCount().then((n) => ({ pending: n })); }
  @Post(':id/status') setStatus(@Param('id') id: string, @Body('status') status: string, @Body('note') note?: string) {
    return this.wd.setStatus(id, status, note);
  }
}
