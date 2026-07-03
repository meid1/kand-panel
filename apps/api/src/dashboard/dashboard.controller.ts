import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private dash: DashboardService) {}

  @Get('summary')
  summary(@Query('tenantId') tenantId?: string) {
    return this.dash.summary(tenantId);
  }
}
