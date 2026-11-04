import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE, Reflector } from '@nestjs/core';
import { CoreLoggingModule } from './logging/logging.module';
import { ProblemDetailsFilter } from './errors/problem-details.filter';
import { RequestContextModule } from './request-context/request-context.module';
import { createValidationPipe } from './validation/validation.pipe';

@Module({
  imports: [CoreLoggingModule, RequestContextModule],
  providers: [
    ProblemDetailsFilter,
    { provide: APP_FILTER, useExisting: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector],
      useFactory: (reflector: Reflector) =>
        new ClassSerializerInterceptor(reflector, {
          excludeExtraneousValues: true,
        }),
    },
  ],
  exports: [RequestContextModule, CoreLoggingModule],
})
export class CoreModule {}
