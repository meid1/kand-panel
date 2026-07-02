import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';
import { ReconcileController } from './reconcile.controller';
import { ReconcileService } from './reconcile.service';

@Module({
  imports: [AuthModule],
  controllers: [ReconcileController],
  providers: [ReconcileService, NodeAgentClient],
  exports: [ReconcileService],
})
export class ReconcileModule {}
