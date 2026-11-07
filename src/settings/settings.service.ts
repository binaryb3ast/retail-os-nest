import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types } from 'mongoose';
import type { ClientSession, Model } from 'mongoose';
import { BranchesService } from '../branches/branches.service';
import { RequestContextService } from '../core/request-context/request-context.service';
import { DatabaseTransactionService } from '../infrastructure/database/database-transaction.service';
import type { SettingTarget } from './domain/setting-scope';
import { SettingAuditRecord } from './persistence/setting-audit.schema';
import type { SettingAuditAction } from './persistence/setting-audit.schema';
import { SettingRecord } from './persistence/setting.schema';
import { isSettingKey, settingsRegistry } from './registry/settings.registry';
import type { SettingKey, SettingValue } from './registry/settings.registry';
import { settingException } from './settings.errors';
import { supportsScope } from './registry/settings.definition';
import type { SettingCategory } from './registry/settings.definition';

export interface SettingResolution<Value> {
  readonly key: string;
  readonly value: Value;
  readonly source: 'DEFAULT' | 'SYSTEM' | 'BRANCH';
  readonly revision: number | null;
}

export interface SettingWriteOptions {
  readonly expectedRevision: number;
  readonly actorId: Types.ObjectId;
  readonly reason?: string;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(SettingRecord.name)
    private readonly settings: Model<SettingRecord>,
    @InjectModel(SettingAuditRecord.name)
    private readonly audits: Model<SettingAuditRecord>,
    private readonly branches: BranchesService,
    private readonly transactions: DatabaseTransactionService,
    private readonly requestContext: RequestContextService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Production disables Mongoose autoIndex; explicitly provision these invariants.
    await this.settings.createIndexes();
    await this.audits.createIndexes();
  }

  async get<Key extends SettingKey>(
    key: Key,
    context?: { readonly branchId?: string },
  ): Promise<SettingValue<Key>> {
    return (await this.resolve(key, context)).value;
  }

  async resolve<Key extends SettingKey>(
    key: Key,
    context?: { readonly branchId?: string },
  ): Promise<SettingResolution<SettingValue<Key>>> {
    const definition = this.definition(key);
    const branchId = context?.branchId;
    if (branchId !== undefined) {
      const objectId = this.parseBranchId(branchId);
      await this.assertBranchExists(objectId);
      if (
        supportsScope(definition, 'BRANCH') &&
        (definition.branchOverride || !supportsScope(definition, 'SYSTEM'))
      ) {
        const branchValue = await this.findRecord(key, 'BRANCH', objectId);
        if (branchValue)
          return this.resolution(
            key,
            branchValue.value,
            'BRANCH',
            branchValue.revision,
          );
      }
    } else if (
      supportsScope(definition, 'BRANCH') &&
      !supportsScope(definition, 'SYSTEM')
    ) {
      throw settingException(
        'SETTING_BRANCH_REQUIRED',
        HttpStatus.BAD_REQUEST,
        'A branch identifier is required for this setting.',
      );
    }

    const mayUseSystem =
      branchId === undefined ||
      !supportsScope(definition, 'BRANCH') ||
      definition.systemFallback;
    if (supportsScope(definition, 'SYSTEM') && mayUseSystem) {
      const systemValue = await this.findRecord(key, 'SYSTEM', null);
      if (systemValue)
        return this.resolution(
          key,
          systemValue.value,
          'SYSTEM',
          systemValue.revision,
        );
    }
    return this.resolution(key, definition.defaultValue, 'DEFAULT', null);
  }

  async getMany<const Keys extends readonly SettingKey[]>(
    keys: Keys,
    context?: { readonly branchId?: string },
  ): Promise<{ readonly [Key in Keys[number]]: SettingValue<Key> }> {
    const branchId = context?.branchId
      ? this.parseBranchId(context.branchId)
      : undefined;
    const keyList = [...new Set(keys)];
    if (branchId) {
      await this.assertBranchExists(branchId);
    } else {
      for (const key of keyList) {
        const definition = this.definition(key);
        if (
          supportsScope(definition, 'BRANCH') &&
          !supportsScope(definition, 'SYSTEM')
        ) {
          throw settingException(
            'SETTING_BRANCH_REQUIRED',
            HttpStatus.BAD_REQUEST,
            'A branch identifier is required for a requested setting.',
          );
        }
      }
    }
    const [systemRecords, branchRecords] = await Promise.all([
      this.settings
        .find({ key: { $in: keyList }, scope: 'SYSTEM', branchId: null })
        .lean()
        .exec(),
      branchId
        ? this.settings
            .find({ key: { $in: keyList }, scope: 'BRANCH', branchId })
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);
    const systemByKey = new Map(
      systemRecords.map((record) => [record.key, record]),
    );
    const branchByKey = new Map(
      branchRecords.map((record) => [record.key, record]),
    );
    const result: Partial<Record<SettingKey, unknown>> = {};
    for (const key of keyList) {
      const definition = this.definition(key);
      if (
        branchId &&
        supportsScope(definition, 'BRANCH') &&
        (definition.branchOverride || !supportsScope(definition, 'SYSTEM'))
      ) {
        const branch = branchByKey.get(key);
        if (branch) {
          result[key] = this.validateStoredValue(key, branch.value);
          continue;
        }
      }
      const mayUseSystem =
        !branchId ||
        !supportsScope(definition, 'BRANCH') ||
        definition.systemFallback;
      if (supportsScope(definition, 'SYSTEM') && mayUseSystem) {
        const system = systemByKey.get(key);
        if (system) {
          result[key] = this.validateStoredValue(key, system.value);
          continue;
        }
      }
      result[key] = definition.schema.parse(definition.defaultValue);
    }
    return result as { readonly [Key in Keys[number]]: SettingValue<Key> };
  }

  async getAll(context?: {
    readonly branchId?: string;
  }): Promise<Readonly<Record<SettingKey, unknown>>> {
    const keys = Object.keys(settingsRegistry) as SettingKey[];
    const values = await this.getMany(keys, context);
    return values;
  }

  getDefinition<Key extends SettingKey>(
    key: Key,
  ): (typeof settingsRegistry)[Key] {
    return this.definition(key);
  }

  getDefinitions(
    category?: SettingCategory,
  ): readonly (typeof settingsRegistry)[SettingKey][] {
    return (Object.keys(settingsRegistry) as SettingKey[])
      .map((key) => settingsRegistry[key])
      .filter(
        (definition) =>
          category === undefined || definition.category === category,
      );
  }

  async set<Key extends SettingKey>(
    key: Key,
    value: SettingValue<Key>,
    target: SettingTarget,
    options: SettingWriteOptions,
  ): Promise<SettingResolution<SettingValue<Key>>> {
    const definition = this.definition(key);
    if (!definition.editable) {
      throw settingException(
        'SETTING_READ_ONLY',
        HttpStatus.FORBIDDEN,
        'This setting cannot be edited.',
      );
    }
    const parsedValue = this.parseValue(key, value);
    const branchId =
      target.scope === 'BRANCH' ? this.parseBranchId(target.branchId) : null;
    this.assertWritableScope(key, target);

    try {
      return await this.transactions.execute(async (session) => {
        if (branchId) await this.assertBranchExists(branchId, session);
        const filter = { key, scope: target.scope, branchId };
        const existing = await this.settings
          .findOne(filter)
          .session(session)
          .exec();
        if (!existing) {
          if (options.expectedRevision !== 0) this.throwRevisionConflict();
          const record = new this.settings({
            ...filter,
            value: parsedValue,
            revision: 1,
            updatedBy: options.actorId,
          });
          await record.save({ session });
          const action =
            target.scope === 'BRANCH' && supportsScope(definition, 'SYSTEM')
              ? 'SETTING.BRANCH_OVERRIDE.CREATED'
              : 'SETTING.CREATED';
          await this.writeAudit(
            session,
            action,
            key,
            target,
            null,
            parsedValue,
            1,
            options,
          );
          return { key, value: parsedValue, source: target.scope, revision: 1 };
        }

        if (existing.revision !== options.expectedRevision)
          this.throwRevisionConflict();
        const previousValue = this.validateStoredValue(key, existing.value);
        existing.value = parsedValue;
        existing.revision += 1;
        existing.updatedBy = options.actorId;
        await existing.save({ session });
        await this.writeAudit(
          session,
          'SETTING.UPDATED',
          key,
          target,
          previousValue,
          parsedValue,
          existing.revision,
          options,
        );
        return {
          key,
          value: parsedValue,
          source: target.scope,
          revision: existing.revision,
        };
      });
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) this.throwRevisionConflict();
      throw error;
    }
  }

  async reset(
    key: SettingKey,
    target: SettingTarget,
    options: SettingWriteOptions,
  ): Promise<void> {
    const definition = this.definition(key);
    if (!definition.editable) {
      throw settingException(
        'SETTING_READ_ONLY',
        HttpStatus.FORBIDDEN,
        'This setting cannot be edited.',
      );
    }
    const branchId =
      target.scope === 'BRANCH' ? this.parseBranchId(target.branchId) : null;
    this.assertWritableScope(key, target);

    await this.transactions.execute(async (session) => {
      if (branchId) await this.assertBranchExists(branchId, session);
      const record = await this.settings
        .findOne({ key, scope: target.scope, branchId })
        .session(session)
        .exec();
      if (!record) {
        if (options.expectedRevision !== 0) this.throwRevisionConflict();
        return;
      }
      if (record.revision !== options.expectedRevision)
        this.throwRevisionConflict();
      const previousValue = this.validateStoredValue(key, record.value);
      await record.deleteOne({ session });
      const action =
        target.scope === 'BRANCH' && supportsScope(definition, 'SYSTEM')
          ? 'SETTING.BRANCH_OVERRIDE.REMOVED'
          : 'SETTING.RESET';
      await this.writeAudit(
        session,
        action,
        key,
        target,
        previousValue,
        null,
        record.revision + 1,
        options,
      );
    });
  }

  private definition<Key extends SettingKey>(
    key: Key,
  ): (typeof settingsRegistry)[Key] {
    if (!isSettingKey(key)) {
      throw settingException(
        'SETTING_NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'The setting is not defined.',
      );
    }
    return settingsRegistry[key];
  }

  private async findRecord(
    key: SettingKey,
    scope: 'SYSTEM' | 'BRANCH',
    branchId: Types.ObjectId | null,
  ) {
    const record = await this.settings
      .findOne({ key, scope, branchId })
      .lean()
      .exec();
    if (!record) return null;
    return {
      value: this.validateStoredValue(key, record.value),
      revision: record.revision,
    };
  }

  private resolution<Key extends SettingKey>(
    key: Key,
    value: unknown,
    source: SettingResolution<unknown>['source'],
    revision: number | null,
  ): SettingResolution<SettingValue<Key>> {
    return {
      key,
      value: this.validateStoredValue(key, value),
      source,
      revision,
    };
  }

  private validateStoredValue<Key extends SettingKey>(
    key: Key,
    value: unknown,
  ): SettingValue<Key> {
    const parsed = settingsRegistry[key].schema.safeParse(value);
    if (!parsed.success) {
      this.logger.error({ key }, 'Invalid persisted setting value detected');
      throw settingException(
        'SETTING_DATA_CORRUPT',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'A stored setting value is invalid.',
      );
    }
    return parsed.data as SettingValue<Key>;
  }

  private parseValue<Key extends SettingKey>(
    key: Key,
    value: unknown,
  ): SettingValue<Key> {
    const parsed = settingsRegistry[key].schema.safeParse(value);
    if (!parsed.success) {
      throw settingException(
        'SETTING_INVALID_VALUE',
        HttpStatus.BAD_REQUEST,
        'The setting value is invalid.',
      );
    }
    return parsed.data as SettingValue<Key>;
  }

  private parseBranchId(value: string): Types.ObjectId {
    if (!/^[a-f\d]{24}$/i.test(value) || !isValidObjectId(value)) {
      throw settingException(
        'BRANCH_ID_INVALID',
        HttpStatus.BAD_REQUEST,
        'The branch identifier is invalid.',
      );
    }
    return new Types.ObjectId(value);
  }

  private async assertBranchExists(
    branchId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const branch = await this.branches.findActiveById(branchId, session);
    if (!branch)
      throw settingException(
        'BRANCH_NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'The branch does not exist.',
      );
  }

  private assertWritableScope(key: SettingKey, target: SettingTarget): void {
    const definition = this.definition(key);
    if (!supportsScope(definition, target.scope)) {
      throw settingException(
        'SETTING_SCOPE_UNSUPPORTED',
        HttpStatus.BAD_REQUEST,
        'This setting does not support the requested scope.',
      );
    }
    if (
      target.scope === 'BRANCH' &&
      supportsScope(definition, 'SYSTEM') &&
      !definition.branchOverride
    ) {
      throw settingException(
        'SETTING_BRANCH_OVERRIDE_FORBIDDEN',
        HttpStatus.FORBIDDEN,
        'Branch overrides are not allowed for this setting.',
      );
    }
  }

  private throwRevisionConflict(): never {
    throw settingException(
      'SETTING_REVISION_CONFLICT',
      HttpStatus.CONFLICT,
      'The setting changed since it was read.',
    );
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }

  private async writeAudit(
    session: ClientSession,
    action: SettingAuditAction,
    key: SettingKey,
    target: SettingTarget,
    previousValue: unknown,
    newValue: unknown,
    revision: number,
    options: SettingWriteOptions,
  ): Promise<void> {
    const requestId = this.requestContext.current()?.requestId ?? 'system';
    await this.audits.create(
      [
        {
          action,
          key,
          scope: target.scope,
          branchId:
            target.scope === 'BRANCH'
              ? this.parseBranchId(target.branchId)
              : null,
          previousValue,
          newValue,
          actorId: options.actorId,
          requestId,
          reason: options.reason?.slice(0, 500) ?? null,
          revision,
        },
      ],
      { session },
    );
  }
}
