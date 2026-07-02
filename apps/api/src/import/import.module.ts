import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { NodesModule } from '../nodes/nodes.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [AuthModule, UsersModule, NodesModule], // platformTenantId + создание нод при импорте
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
