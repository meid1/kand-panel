import { Module } from '@nestjs/common';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';
import { ReconcileModule } from '../reconcile/reconcile.module';
import { PaymentsModule } from '../payments/payments.module';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [ReconcileModule, PaymentsModule], // авто-хил + автосписание с карты (рекуррент)
  providers: [MonitoringService, NodeAgentClient],
  exports: [MonitoringService],
})
export class MonitoringModule {}
