import { Body, Controller, Delete, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';

@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private campaigns: CampaignsService) {}
  @Get() list() { return this.campaigns.list(); }
  @Post() create(@Body() dto: any) { return this.campaigns.create(dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.campaigns.remove(id); }
}

/** Публичный редирект-трекер: panel/c/<code> — считает клик и ведёт в бота. Без авторизации и без /api. */
@Controller('c')
export class CampaignClickController {
  constructor(private campaigns: CampaignsService) {}
  @Get(':code')
  async click(@Param('code') code: string, @Res() res: Response) {
    const url = await this.campaigns.trackClick(code);
    res.redirect(302, url || process.env.PANEL_URL || '/');
  }
}
