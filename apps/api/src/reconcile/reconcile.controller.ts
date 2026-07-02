import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReconcileService } from './reconcile.service';

@UseGuards(JwtAuthGuard)
@Controller('reconcile')
export class ReconcileController {
  constructor(private reconcile: ReconcileService) {}

  @Post('all')
  all() {
    return this.reconcile.reconcileAll();
  }

  @Post('node/:id')
  node(@Param('id') id: string) {
    return this.reconcile.reconcileNode(id);
  }
}
