import {
  Body, Controller, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { CreateUserDto, GrantDaysDto } from './dto/create-user.dto';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  list(@Query('tenantId') tenantId?: string) {
    return this.users.findAll(tenantId);
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
}
