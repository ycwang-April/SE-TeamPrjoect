/**
 * Host-isolated Secret Vault persisting provider keys outside SQLite logs.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import type {ProviderSecretResolved} from '../adapters/contracts.ts';
import type {OrchestratorStore} from '../store/database.ts';

interface VaultDiskPayload {
  readonly keys: Record<string, string>;
}

const ENV_FALLBACK: Readonly<Record<string, string>> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export class HostSecretVault {
  private readonly filePath: string;
  private keys: Record<string, string> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.filePath, 'utf8'),
      ) as Partial<VaultDiskPayload>;
      if (parsed.keys && typeof parsed.keys === 'object') {
        this.keys = {...parsed.keys};
      }
    } catch {
      this.keys = {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), {recursive: true});
    const payload: VaultDiskPayload = {keys: this.keys};
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  setApiKey(providerId: string, rawKey: string): void {
    const trimmed = rawKey.trim();
    if (!trimmed) {
      delete this.keys[providerId];
    } else {
      this.keys[providerId] = trimmed;
    }
    this.persist();
  }

  getKeyStatus(providerId: string): {
    readonly hasApiKey: boolean;
    readonly maskedKeyHint: string;
  } {
    const raw = this.getRawApiKey(providerId);
    if (!raw) {
      return {hasApiKey: false, maskedKeyHint: 'Not configured'};
    }
    return {
      hasApiKey: true,
      maskedKeyHint: `${raw.slice(0, Math.min(4, raw.length))}••••${raw.slice(-4)}`,
    };
  }

  getRawApiKey(providerId: string): string | null {
    const explicit = this.keys[providerId];
    if (explicit?.trim()) {
      return explicit;
    }
    const envVar = ENV_FALLBACK[providerId];
    if (envVar && process.env[envVar]) {
      return process.env[envVar] ?? null;
    }
    return null;
  }

  resolveProvider(
    store: OrchestratorStore,
    providerId: string,
  ): ProviderSecretResolved | null {
    const providers = store.listModelProviders(id => this.getKeyStatus(id));
    const found = providers.find(p => p.id === providerId);
    if (!found) {
      return null;
    }
    return {
      providerId: found.id,
      protocol: found.protocol,
      baseUrl: found.baseUrl,
      apiKey: this.getRawApiKey(found.id),
    };
  }
}
