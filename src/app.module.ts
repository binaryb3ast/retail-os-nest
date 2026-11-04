import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { CoreConfigModule } from './core/config/config.module';
import { CoreModule } from './core/core.module';

@Module({
  imports: [CoreConfigModule, CoreModule, DatabaseModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
