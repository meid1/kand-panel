import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PollsService } from './polls.service';

@UseGuards(JwtAuthGuard)
@Controller('polls')
export class PollsController {
  constructor(private polls: PollsService) {}
  @Get() list() { return this.polls.list(); }
  @Post() create(@Body() dto: any) { return this.polls.create(dto); }
  @Patch(':id') setActive(@Param('id') id: string, @Body('isActive') isActive: boolean) { return this.polls.setActive(id, !!isActive); }
  @Delete(':id') remove(@Param('id') id: string) { return this.polls.remove(id); }
}
