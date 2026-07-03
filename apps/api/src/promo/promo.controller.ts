import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PromoService } from './promo.service';

@UseGuards(JwtAuthGuard)
@Controller('promo')
export class PromoController {
  constructor(private promo: PromoService) {}
  @Get() list() { return this.promo.list(); }
  @Post() create(@Body() dto: any) { return this.promo.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: any) { return this.promo.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.promo.remove(id); }
}
