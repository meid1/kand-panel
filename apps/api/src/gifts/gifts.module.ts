import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';

@Module({ imports: [AuthModule, UsersModule], controllers: [GiftsController], providers: [GiftsService], exports: [GiftsService] })
export class GiftsModule {}
