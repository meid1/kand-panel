import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WarpModule } from '../warp/warp.module';
import { ReconcileModule } from '../reconcile/reconcile.module';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  imports: [AuthModule, WarpModule, ReconcileModule], // guard + WARP + reconcile (после пуша конфига)
  controllers: [NodesController],
  providers: [NodesService, NodeAgentClient],
  exports: [NodesService],
})
export class NodesModule {}
