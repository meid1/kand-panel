import {
  Body, Controller, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { DevicesService } from '../devices/devices.service';
import { CreateUserDto, GrantDaysDto } from './dto/create-user.dto';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService, private devices: DevicesService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  // Ручное создание ключа: клиент без Telegram + сразу устройство и ссылки подписки.
  // Отдаём готовые ссылки, чтобы админ мог передать их «на руки».
  @Post('manual')
  async manual(@Body() body: { name?: string; days?: number; tenantId?: string }) {
    const user = await this.users.createManual(body?.name, Number(body?.days) || 0, body?.tenantId);
    const device = await this.devices.create(user.id, body?.name || 'Ручной ключ');
    const base = (process.env.PANEL_URL || '').replace(/\/+$/, '');
    return {
      user,
      device,
      links: {
        sub: `${base}/sub/${device.subToken}`,
        xray: `${base}/sub/${device.subToken}/xray`,
        tv: `${base}/t/${device.tvCode}`,
        cabinet: `${base}/cabinet/${device.subToken}`,
      },
    };
  }

  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.users.findAll({ tenantId, search, limit: Number(limit), offset: Number(offset) });
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post(':id/grant-days')
  grant(@Param('id') id: string, @Body() dto: GrantDaysDto) {
    return this.users.grantDays(id, dto.days);
  }

  @Patch(':id/block')
  block(@Param('id') id: string, @Body('blocked') blocked: boolean) {
    return this.users.setBlocked(id, blocked);
  }

  // принудительно включить ключ в живом бэкенде
  @Post(':id/force-enable')
  forceEnable(@Param('id') id: string) {
    return this.users.forceEnable(id);
  }

  @Post(':id/issue-key')
  issueKey(@Param('id') id: string) {
    return this.users.issueKey(id);
  }

  @Post(':id/delete-key')
  deleteKey(@Param('id') id: string) {
    return this.users.deleteKey(id);
  }

  // корректировка баланса (amount +/−)
  @Post(':id/balance')
  balance(@Param('id') id: string, @Body('amount') amount: number) {
    return this.users.adjustBalance(id, Number(amount));
  }
}
