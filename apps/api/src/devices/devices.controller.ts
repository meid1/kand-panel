import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DevicesService } from './devices.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class DevicesController {
  constructor(private devices: DevicesService) {}

  @Get('users/:userId/devices')
  list(@Param('userId') userId: string) {
    return this.devices.listForUser(userId);
  }

  @Post('users/:userId/devices')
  create(@Param('userId') userId: string, @Body('name') name?: string) {
    return this.devices.create(userId, name);
  }

  @Delete('devices/:id')
  remove(@Param('id') id: string) {
    return this.devices.remove(id);
  }
}
