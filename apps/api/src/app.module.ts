import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './crypto/crypto.module';
import { NodesModule } from './nodes/nodes.module';
import { UsersModule } from './users/users.module';
import { DevicesModule } from './devices/devices.module';
import { ReconcileModule } from './reconcile/reconcile.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { PaymentsModule } from './payments/payments.module';
import { InstallModule } from './install/install.module';
import { StatsModule } from './stats/stats.module';
import { SettingsModule } from './settings/settings.module';
import { BroadcastModule } from './broadcast/broadcast.module';
import { ImportModule } from './import/import.module';
import { TenantsModule } from './tenants/tenants.module';
import { AuditModule } from './audit/audit.module';
import { BypassModule } from './bypass/bypass.module';
import { BotModule } from './bot/bot.module';
import { CabinetModule } from './cabinet/cabinet.module';
import { ReferralModule } from './referral/referral.module';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { PlansModule } from './plans/plans.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { PromoModule } from './promo/promo.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MultibotModule } from './multibot/multibot.module';
import { FinanceModule } from './finance/finance.module';
import { BridgeModule } from './bridge/bridge.module';
import { SyncModule } from './sync/sync.module';
import { FeaturesModule } from './features/features.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(), // периодический сбор трафика
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]), // rate-limit API
    PrismaModule,
    CryptoModule,
    AuthModule,
    NodesModule,
    UsersModule,
    DevicesModule,
    ReconcileModule,
    SubscriptionModule,
    PaymentsModule,
    InstallModule,
    StatsModule,
    SettingsModule,
    BroadcastModule,
    ImportModule,
    TenantsModule,
    AuditModule,
    BypassModule,
    BotModule,
    CabinetModule,
    ReferralModule,
    DiagnosticsModule,
    PlansModule,
    MonitoringModule,
    PromoModule,
    DashboardModule,
    MultibotModule,
    FinanceModule,
    BridgeModule,
    SyncModule,
    FeaturesModule,
    OnboardingModule,
    TicketsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
