import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  BackendState,
  Provider,
  ProviderPublic,
  ProxyUsage,
} from '../src/lib/proxyTypes';

// 持久化到用户主目录下的隐藏文件，含 key 明文，故不放进项目目录、不进 git。
const STORE_DIR = path.join(os.homedir(), '.tokengate');
const STORE_FILE = path.join(STORE_DIR, 'state.json');
const MAX_USAGES = 5000;

let state: BackendState = { providers: [], keys: {}, usages: [] };

export function loadStore(): void {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<BackendState>;
      state = {
        providers: parsed.providers ?? [],
        keys: parsed.keys ?? {},
        usages: parsed.usages ?? [],
      };
    }
  } catch {
    state = { providers: [], keys: {}, usages: [] };
  }
}

function persist(): void {
  try {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('持久化失败：', (e as Error).message);
  }
}

function maskKey(key?: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function toPublic(p: Provider): ProviderPublic {
  const key = state.keys[p.id];
  return { ...p, hasKey: !!key, keyMasked: maskKey(key) };
}

export function listProviders(): ProviderPublic[] {
  return state.providers.map(toPublic);
}

export function getProvider(id: string): Provider | undefined {
  return state.providers.find((p) => p.id === id);
}

export function getKey(id: string): string | undefined {
  return state.keys[id];
}

export function upsertProvider(
  data: Omit<Provider, 'id'> & { id?: string },
  key?: string,
): ProviderPublic {
  let prov: Provider;
  if (data.id && state.providers.some((p) => p.id === data.id)) {
    prov = { ...(state.providers.find((p) => p.id === data.id) as Provider), ...data, id: data.id };
    state.providers = state.providers.map((p) => (p.id === prov.id ? prov : p));
  } else {
    prov = { ...data, id: data.id ?? randomUUID() };
    state.providers.push(prov);
  }
  // 只有显式传了非空 key 才更新；空字符串=不改
  if (typeof key === 'string' && key.trim()) {
    state.keys[prov.id] = key.trim();
  }
  persist();
  return toPublic(prov);
}

export function deleteProvider(id: string): void {
  state.providers = state.providers.filter((p) => p.id !== id);
  delete state.keys[id];
  persist();
}

export function addUsage(u: Omit<ProxyUsage, 'id' | 'at'> & { at?: string }): ProxyUsage {
  const usage: ProxyUsage = { id: randomUUID(), at: u.at ?? new Date().toISOString(), ...u };
  state.usages.unshift(usage);
  if (state.usages.length > MAX_USAGES) state.usages.length = MAX_USAGES;
  persist();
  return usage;
}

export function listUsages(): ProxyUsage[] {
  return state.usages;
}

/** 每个 provider 已消耗与剩余额度 */
export function quotaStatus(): {
  providerId: string;
  name: string;
  plan: string;
  quotaUsd: number;
  usedUsd: number;
  remainingUsd: number;
}[] {
  return state.providers.map((p) => {
    const usedUsd = state.usages
      .filter((u) => u.providerId === p.id)
      .reduce((a, u) => a + u.costUsd, 0);
    return {
      providerId: p.id,
      name: p.name,
      plan: p.plan,
      quotaUsd: p.quotaUsd,
      usedUsd,
      remainingUsd: p.quotaUsd > 0 ? p.quotaUsd - usedUsd : 0,
    };
  });
}
