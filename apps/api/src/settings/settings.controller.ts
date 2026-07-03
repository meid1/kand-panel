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

  // редактируемые флаги/значения (обязательная подписка, согласие, триал, реф-бонусы…)
  @Get('flags')
  flags() { return this.settings.flags(); }

  @Put('flag/:key')
  setFlag(@Param('key') key: string, @Body('value') value: string) {
    return this.settings.setFlag(key, value);
  }

  // кастомная маршрутизация (свои сайты → напрямую/блок/через VPN)
  @Get('routing')
  getRouting() { return this.settings.getRouting(); }

  @Put('routing')
  setRouting(@Body() body: any) { return this.settings.setRouting(body); }

  // кастомные кнопки бота
  @Get('buttons')
  getButtons() { return this.settings.getButtons(); }

  @Put('buttons')
  setButtons(@Body('buttons') buttons: any[]) { return this.settings.setButtons(buttons); }
}
