import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BypassService } from './bypass.service';

@UseGuards(JwtAuthGuard)
@Controller('bypass')
export class BypassController {
  constructor(private bypass: BypassService) {}

  @Get(':userId')
  state(@Param('userId') userId: string) {
    return this.bypass.state(userId);
  }

  @Post(':userId/add')
  add(@Param('userId') userId: string, @Body('gb') gb: number) {
    return this.bypass.addGb(userId, Number(gb));
  }

  // списание — без уведомления клиента (по требованию владельца)
  @Post(':userId/deduct')
  deduct(@Param('userId') userId: string, @Body('gb') gb: number) {
    return this.bypass.deductGb(userId, Number(gb));
  }

  // сброс счётчика обхода (при кривом импорте/расхождении учёта)
  @Post(':userId/reset')
  reset(@Param('userId') userId: string) {
    return this.bypass.reset(userId);
  }

  @Post('reset-all')
  resetAll() {
    return this.bypass.resetAll();
  }
}
