import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  // последние действия в админке (по умолчанию 100)
  @Get()
  list(@Query('limit') limit?: string) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
    });
  }
}
