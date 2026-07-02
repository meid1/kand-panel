import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}
  @Get()
  async check() {
    let db = false;
    try { await this.prisma.$queryRaw`SELECT 1`; db = true; } catch {}
    return { ok: true, db, ts: new Date().toISOString() };
  }
}
