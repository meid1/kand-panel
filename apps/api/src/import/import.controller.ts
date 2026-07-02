import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImportService, ImportBody } from './import.service';

@UseGuards(JwtAuthGuard)
@Controller('import')
export class ImportController {
  constructor(private imp: ImportService) {}

  // проверка без записи — вернёт сколько импортируется и что не так
  @Post('dry-run')
  dryRun(@Body() body: ImportBody) {
    return this.imp.dryRun(body);
  }

  // реальный импорт (после успешного dry-run)
  @Post('run')
  run(@Body() body: ImportBody) {
    return this.imp.run(body);
  }
}
