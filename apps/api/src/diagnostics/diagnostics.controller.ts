import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DiagnosticsService } from './diagnostics.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class DiagnosticsController {
  constructor(private diag: DiagnosticsService) {}

  @Get(':id/diagnose')
  diagnose(@Param('id') id: string) {
    return this.diag.forUser(id);
  }

  @Post(':id/fix')
  fix(@Param('id') id: string) {
    return this.diag.fix(id);
  }
}
