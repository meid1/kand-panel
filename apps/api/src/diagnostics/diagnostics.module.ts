import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReconcileModule } from '../reconcile/reconcile.module';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [AuthModule, ReconcileModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
