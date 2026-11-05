import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model } from 'mongoose';
import { RequestContextService } from '../core/request-context/request-context.service';
import { AuditEventRecord } from './audit-event.schema';
import type { UserAuditEventInput } from './audit.types';

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(
    @InjectModel(AuditEventRecord.name)
    private readonly events: Model<AuditEventRecord>,
    private readonly requestContext: RequestContextService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.events.createIndexes();
  }

  async record(
    event: UserAuditEventInput,
    session: ClientSession,
  ): Promise<void> {
    const context = this.requestContext.current();
    await this.events.create(
      [
        {
          action: event.action,
          actorType: event.actor.type,
          actorUserId: event.actor.type === 'USER' ? event.actor.userId : null,
          actorLabel: event.actor.type === 'SYSTEM' ? event.actor.label : null,
          targetType: event.targetType,
          targetId: event.targetId,
          userId: event.userId,
          identityType: event.identityType ?? null,
          previousStatus: event.previousStatus ?? null,
          newStatus: event.newStatus ?? null,
          branchId: event.branchId ?? null,
          requestId: context?.requestId ?? 'system',
          correlationId: context?.correlationId ?? 'system',
          reason: event.reason?.slice(0, 500) ?? null,
        },
      ],
      { session },
    );
  }
}
