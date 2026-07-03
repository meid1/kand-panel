import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FinanceService } from './finance.service';

@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceController {
  constructor(private finance: FinanceService) {}

  @Get('summary')
  summary(@Query('tenantId') tenantId?: string) {
    return this.finance.summary(tenantId);
  }

  @Get('ledger')
  ledger(@Query('tenantId') tenantId?: string) {
    return this.finance.listLedger(tenantId);
  }

  @Post('ledger')
  add(@Body() b: { kind: string; amount: number; note?: string; tenantId?: string }) {
    return this.finance.addLedger(b.kind, Number(b.amount), b.note, b.tenantId);
  }

  @Delete('ledger/:id')
  remove(@Param('id') id: string) {
    return this.finance.removeLedger(id);
  }
}
