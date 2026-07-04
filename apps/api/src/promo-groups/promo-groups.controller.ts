import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PromoGroupsService } from './promo-groups.service';

@UseGuards(JwtAuthGuard)
@Controller('promo-groups')
export class PromoGroupsController {
  constructor(private groups: PromoGroupsService) {}
  @Get() list() { return this.groups.list(); }
  @Post() create(@Body() dto: any) { return this.groups.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: any) { return this.groups.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.groups.remove(id); }
}
