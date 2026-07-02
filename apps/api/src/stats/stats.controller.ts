import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatsService } from './stats.service';

@UseGuards(JwtAuthGuard)
@Controller('stats')
export class StatsController {
  constructor(private stats: StatsService) {}

  // ручной запуск сбора трафика (обычно идёт по расписанию раз в 5 мин)
  @Post('collect')
  collect() {
    return this.stats.collectAll();
  }
}
