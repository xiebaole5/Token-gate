import { EventEmitter } from 'node:events';
import type { ProxyUsage } from '../src/lib/proxyTypes';

/** 用量事件总线：代理捕获到 usage 后 emit，SSE 路由订阅后推给前端。 */
class UsageBus extends EventEmitter {}
export const usageBus = new UsageBus();

export function emitUsage(u: ProxyUsage): void {
  usageBus.emit('usage', u);
}
