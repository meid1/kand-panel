import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GiftsService } from './gifts.service';

@UseGuards(JwtAuthGuard)
@Controller('gifts')
export class GiftsController {
  constructor(private gifts: GiftsService) {}
  @Get() list() { return this.gifts.list(); }
  @Post() create(@Body() dto: any) { return this.gifts.create(dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.gifts.remove(id); }
}
