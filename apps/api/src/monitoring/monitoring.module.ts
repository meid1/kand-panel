import { Module } from '@nestjs/common';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';
import { ReconcileModule } from '../reconcile/reconcile.module';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [ReconcileModule], // авто-хил: при возврате ноды онлайн перераскатываем ключи
  providers: [MonitoringService, NodeAgentClient],
  exports: [MonitoringService],
})
export class MonitoringModule {}
