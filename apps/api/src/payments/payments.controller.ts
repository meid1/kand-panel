import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  // ── защищённое (админка/бот) ─────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('invoice')
  invoice(@Body() dto: CreateInvoiceDto) {
    return this.payments.createInvoice(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Query('tenantId') tenantId?: string) {
    return this.payments.list(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('providers')
  providers() {
    return this.payments.adminList();
  }

  // способы оплаты для клиента (публично — только id/название включённых)
  @Get('methods')
  methods() {
    return this.payments.available();
  }

  // ── публичный вебхук провайдера (подпись проверяется внутри провайдера) ────
  @Post('webhook/:provider')
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    return this.payments.handleWebhook(provider, req.headers as any, raw);
  }
}
