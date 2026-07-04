import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

// @Global — чтобы бот/кабинет могли открывать тикеты через TicketsService
@Global()
@Module({
  imports: [AuthModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
