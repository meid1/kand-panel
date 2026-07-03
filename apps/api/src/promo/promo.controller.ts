import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PromoService } from './promo.service';

@UseGuards(JwtAuthGuard)
@Controller('promo')
export class PromoController {
  constructor(private promo: PromoService) {}
  @Get() list() { return this.promo.list(); }
  @Post() create(@Body() dto: any) { return this.promo.create(dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.promo.remove(id); }
}
