import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BroadcastService } from './broadcast.service';

@UseGuards(JwtAuthGuard)
@Controller('broadcast')
export class BroadcastController {
  constructor(private broadcast: BroadcastService) {}

  // старт: {text} ЛИБО {fromChatId, messageId} (копия — с премиум-эмодзи/медиа)
  @Post()
  start(@Body() body: {
    text?: string; fromChatId?: number | string; messageId?: number;
    tenantId?: string; testChatId?: number | string;
  }) {
    return this.broadcast.start(body);
  }

  @Get('status')
  status() {
    return this.broadcast.status();
  }
}
