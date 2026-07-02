import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  // все тексты с актуальными значениями (для формы админки — не пустые)
  @Get('texts')
  texts() {
    return this.settings.list();
  }

  @Put('texts/:key')
  update(@Param('key') key: string, @Body('value') value: string) {
    return this.settings.updateText(key, value);
  }

  @Post('texts/:key/reset')
  reset(@Param('key') key: string) {
    return this.settings.resetText(key);
  }

  @Put('brand')
  brand(@Body('brand') brand: string, @Body('support') support?: string) {
    return this.settings.setBrand(brand, support);
  }

  // включить/выключить платёжку + сохранить её ключи
  @Put('pay/:id')
  pay(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.settings.setPay(id, body);
  }
}
