import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { AuditActor } from '../audit/audit.types';
import { ApplicationException } from '../core/errors/application.exception';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import { BranchRecord, BranchStatus } from './branch.schema';

export interface BranchView {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly status: BranchStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ActiveBranchReference {
  readonly id: Types.ObjectId;
}

export interface BranchListResult {
  readonly data: readonly BranchView[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly pageCount: number;
}

@Injectable()
export class BranchesService implements OnModuleInit {
  constructor(
    @InjectModel(BranchRecord.name)
    private readonly branches: Model<BranchRecord>,
    private readonly transactions: DatabaseTransactionService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.branches.createIndexes();
  }

  async create(
    input: { readonly name: string; readonly code: string },
    actor: AuditActor,
    reason?: string,
  ): Promise<BranchView> {
    const name = this.normalizeName(input.name);
    const code = this.normalizeCode(input.code);

    try {
      return await this.transactions.execute(async (session) => {
        const branch = await this.branches.create(
          [{ name, code, status: 'ACTIVE' }],
          { session },
        );
        const created = branch[0];
        await this.audit.record(
          {
            action: 'BRANCH.CREATED',
            actor,
            targetType: 'BRANCH',
            targetId: created._id,
            previousBranchStatus: null,
            newBranchStatus: 'ACTIVE',
            reason,
          },
          session,
        );
        return this.toView(created);
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        throw this.exception(
          'BRANCH_CODE_CONFLICT',
          HttpStatus.CONFLICT,
          'A branch with this code already exists.',
        );
      }
      throw error;
    }
  }

  async getById(id: string): Promise<BranchView> {
    const objectId = this.parseId(id);
    const branch = await this.branches.findById(objectId).exec();
    if (!branch) {
      throw this.exception(
        'BRANCH_NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'The branch does not exist.',
      );
    }
    return this.toView(branch);
  }

  async listAdmin(input: {
    readonly page: number;
    readonly limit: number;
    readonly search?: string;
    readonly status?: BranchStatus;
  }): Promise<BranchListResult> {
    const filter: Record<string, unknown> = {};
    if (input.status) filter.status = input.status;
    const search = input.search?.trim().slice(0, 100);
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { code: { $regex: escaped, $options: 'i' } },
      ];
    }
    const skip = (input.page - 1) * input.limit;
    const [records, total] = await Promise.all([
      this.branches
        .find(filter)
        .sort({ name: 1, _id: 1 })
        .skip(skip)
        .limit(input.limit)
        .exec(),
      this.branches.countDocuments(filter).exec(),
    ]);
    return {
      data: records.map((branch) => this.toView(branch)),
      page: input.page,
      limit: input.limit,
      total,
      pageCount: Math.ceil(total / input.limit),
    };
  }

  async dashboardCounts(): Promise<{
    readonly total: number;
    readonly active: number;
  }> {
    const [total, active] = await Promise.all([
      this.branches.countDocuments({}).exec(),
      this.branches.countDocuments({ status: 'ACTIVE' }).exec(),
    ]);
    return { total, active };
  }

  async findActiveById(
    branchId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ActiveBranchReference | null> {
    let query = this.branches
      .findOne({ _id: branchId, status: 'ACTIVE' })
      .select('_id');
    if (session) query = query.session(session);
    const branch = await query.lean().exec();
    return branch ? { id: branch._id } : null;
  }

  async changeStatus(
    id: string,
    nextStatus: BranchStatus,
    actor: AuditActor,
    reason?: string,
  ): Promise<BranchView> {
    const objectId = this.parseId(id);
    return this.transactions.execute(async (session) => {
      const branch = await this.branches
        .findById(objectId)
        .session(session)
        .exec();
      if (!branch) {
        throw this.exception(
          'BRANCH_NOT_FOUND',
          HttpStatus.NOT_FOUND,
          'The branch does not exist.',
        );
      }
      if (branch.status === nextStatus) return this.toView(branch);

      const previousStatus = branch.status;
      branch.status = nextStatus;
      await branch.save({ session });
      await this.audit.record(
        {
          action: 'BRANCH.STATUS_CHANGED',
          actor,
          targetType: 'BRANCH',
          targetId: branch._id,
          previousBranchStatus: previousStatus,
          newBranchStatus: nextStatus,
          reason,
        },
        session,
      );
      return this.toView(branch);
    });
  }

  private normalizeName(value: string): string {
    if (typeof value !== 'string') {
      throw this.exception(
        'BRANCH_INVALID',
        HttpStatus.BAD_REQUEST,
        'The branch name is invalid.',
      );
    }
    const normalized = value.trim().normalize('NFC');
    if (normalized.length < 1 || normalized.length > 120) {
      throw this.exception(
        'BRANCH_INVALID',
        HttpStatus.BAD_REQUEST,
        'Branch name must contain 1 to 120 characters.',
      );
    }
    return normalized;
  }

  private normalizeCode(value: string): string {
    if (typeof value !== 'string') {
      throw this.exception(
        'BRANCH_INVALID',
        HttpStatus.BAD_REQUEST,
        'The branch code is invalid.',
      );
    }
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(normalized)) {
      throw this.exception(
        'BRANCH_INVALID',
        HttpStatus.BAD_REQUEST,
        'Branch code must contain 2 to 32 letters, numbers, hyphens, or underscores.',
      );
    }
    return normalized;
  }

  private parseId(value: string): Types.ObjectId {
    if (!/^[a-f\d]{24}$/i.test(value)) {
      throw this.exception(
        'BRANCH_ID_INVALID',
        HttpStatus.BAD_REQUEST,
        'The branch identifier is invalid.',
      );
    }
    return new Types.ObjectId(value);
  }

  private toView(branch: BranchRecord & { _id: Types.ObjectId }): BranchView {
    return {
      id: branch._id.toString(),
      name: branch.name,
      code: branch.code,
      status: branch.status,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
    };
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }

  private exception(
    code: string,
    status: HttpStatus,
    detail: string,
  ): ApplicationException {
    return new ApplicationException(code, status, detail);
  }
}
