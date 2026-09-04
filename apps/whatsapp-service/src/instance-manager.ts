import { randomUUID } from 'node:crypto';
import {
  jsonCodec,
  namespaced,
  type EventPublisher,
  type KeyValueStore,
  type Logger,
} from '@connectors/core';
import type { PairingMethod, WhatsAppConnector } from '@connectors/whatsapp';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { Instance, type InstanceDefinition } from './instance.js';

export type { InstanceDefinition, InstanceView } from './instance.js';

export interface InstanceManagerDeps {
  store: KeyValueStore;
  logger: Logger;
  connectorFactory: (definition: InstanceDefinition, authStore: KeyValueStore) => WhatsAppConnector;
  publisherFactory: (definition: InstanceDefinition) => EventPublisher | undefined;
}

export interface CreateInstanceInput {
  id?: string | undefined;
  webhook?: { url: string; secret?: string | undefined } | undefined;
  pairing?: PairingMethod | undefined;
  /** Default true. */
  autoConnect?: boolean | undefined;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const definitionKey = (id: string) => `instances/${id}/definition`;

export class InstanceManager {
  private readonly instances = new Map<string, Instance>();
  /** Ids reserved by an in-flight create(), so two concurrent creates cannot both win. */
  private readonly pending = new Set<string>();
  private readonly logger: Logger;

  constructor(private readonly deps: InstanceManagerDeps) {
    this.logger = deps.logger.child({ component: 'instance-manager' });
  }

  list(): Instance[] {
    return [...this.instances.values()];
  }

  get(id: string): Instance | undefined {
    return this.instances.get(id);
  }

  require(id: string): Instance {
    const instance = this.instances.get(id);
    if (!instance) throw new NotFoundError(`Instance ${id}`);
    return instance;
  }

  async create(input: CreateInstanceInput): Promise<Instance> {
    const id = input.id ?? randomUUID();
    if (!ID_PATTERN.test(id)) throw new ValidationError('id must match [A-Za-z0-9_-]{1,64}');
    if (this.instances.has(id) || this.pending.has(id))
      throw new ConflictError(`Instance ${id} already exists`);
    this.pending.add(id);
    try {
      const definition: InstanceDefinition = {
        id,
        createdAt: new Date().toISOString(),
        pairing: input.pairing ?? { method: 'qr' },
        desiredState: 'disconnected',
        ...(input.webhook ? { webhook: input.webhook } : {}),
      };
      await this.save(definition);
      const instance = this.build(definition);
      this.instances.set(id, instance);
      if (input.autoConnect ?? true) await this.connect(id);
      return instance;
    } finally {
      this.pending.delete(id);
    }
  }

  async connect(id: string): Promise<void> {
    const instance = this.require(id);
    instance.definition.desiredState = 'connected';
    await this.save(instance.definition);
    await instance.connector.connect();
  }

  async disconnect(id: string): Promise<void> {
    const instance = this.require(id);
    instance.definition.desiredState = 'disconnected';
    await this.save(instance.definition);
    await instance.connector.disconnect();
  }

  async remove(id: string): Promise<void> {
    const instance = this.require(id);
    try {
      await instance.connector.logout();
    } catch (err) {
      this.logger.warn(
        { err, instanceId: id },
        'logout failed during removal; clearing storage anyway',
      );
    }
    instance.close();
    this.instances.delete(id);
    await this.deps.store.clear(`instances/${id}/`);
  }

  async restore(): Promise<void> {
    const keys = await this.deps.store.list('instances/');
    for (const key of keys) {
      if (!key.endsWith('/definition')) continue;
      try {
        const bytes = await this.deps.store.get(key);
        if (!bytes) continue;
        const definition = jsonCodec.decode<InstanceDefinition>(bytes);
        if (this.instances.has(definition.id)) continue;
        const instance = this.build(definition);
        this.instances.set(definition.id, instance);
        if (definition.desiredState === 'connected') {
          instance.connector.connect().catch((err: unknown) => {
            this.logger.error(
              { err, instanceId: definition.id },
              'failed to reconnect restored instance',
            );
          });
        }
      } catch (err) {
        this.logger.error({ err, key }, 'failed to restore instance definition; skipping');
      }
    }
    this.logger.info({ count: this.instances.size }, 'instances restored');
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      this.list().map(async (instance) => {
        await instance.connector.disconnect().catch((err: unknown) => {
          this.logger.warn(
            { err, instanceId: instance.definition.id },
            'disconnect failed during shutdown',
          );
        });
        instance.close();
      }),
    );
  }

  private build(definition: InstanceDefinition): Instance {
    const authStore = namespaced(this.deps.store, `instances/${definition.id}`);
    const connector = this.deps.connectorFactory(definition, authStore);
    const publisher = this.deps.publisherFactory(definition);
    return new Instance(definition, connector, publisher, this.logger);
  }

  private async save(definition: InstanceDefinition): Promise<void> {
    await this.deps.store.set(definitionKey(definition.id), jsonCodec.encode(definition));
  }
}
