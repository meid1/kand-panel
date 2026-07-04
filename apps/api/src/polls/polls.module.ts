import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PollsController } from './polls.controller';
import { PollsService } from './polls.service';

@Module({ imports: [AuthModule, UsersModule], controllers: [PollsController], providers: [PollsService], exports: [PollsService] })
export class PollsModule {}
