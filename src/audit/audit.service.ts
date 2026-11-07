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
          userId: event.userId ?? null,
          identityType: event.identityType ?? null,
          previousStatus: event.previousStatus ?? null,
          newStatus: event.newStatus ?? null,
          previousBranchStatus: event.previousBranchStatus ?? null,
          newBranchStatus: event.newBranchStatus ?? null,
          previousMembershipStatus: event.previousMembershipStatus ?? null,
          newMembershipStatus: event.newMembershipStatus ?? null,
          roleCode: event.roleCode ?? null,
          previousPermissions: event.previousPermissions ?? null,
          newPermissions: event.newPermissions ?? null,
          previousRoleActive: event.previousRoleActive ?? null,
          newRoleActive: event.newRoleActive ?? null,
          assignmentScope: event.assignmentScope ?? null,
          previousAssignmentStatus: event.previousAssignmentStatus ?? null,
          newAssignmentStatus: event.newAssignmentStatus ?? null,
          branchId: event.branchId ?? null,
          requestId: context?.requestId ?? 'system',
          correlationId: context?.correlationId ?? 'system',
          reason: event.reason?.slice(0, 500) ?? null,
        },
      ],
      { session },
    );
  }

  async listRecent(limit: number): Promise<
    readonly {
      readonly id: string;
      readonly action: string;
      readonly actorType: 'USER' | 'SYSTEM';
      readonly actorUserId: string | null;
      readonly actorLabel: string | null;
      readonly targetType: string;
      readonly targetId: string;
      readonly userId: string | null;
      readonly branchId: string | null;
      readonly reason: string | null;
      readonly occurredAt: Date;
    }[]
  > {
    const events = await this.events
      .find({})
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(Math.max(limit, 1), 50))
      .lean()
      .exec();
    return events.map((event) => ({
      id: event._id.toString(),
      action: event.action,
      actorType: event.actorType,
      actorUserId: event.actorUserId?.toString() ?? null,
      actorLabel: event.actorLabel,
      targetType: event.targetType,
      targetId: event.targetId.toString(),
      userId: event.userId?.toString() ?? null,
      branchId: event.branchId?.toString() ?? null,
      reason: event.reason,
      occurredAt: event.createdAt,
    }));
  }
}
