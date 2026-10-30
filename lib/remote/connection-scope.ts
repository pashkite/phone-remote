/** One connection attempt owns its asynchronous work. Closing it invalidates late responses. */
export class ConnectionScope {
  private controller = new AbortController();
  get active() { return !this.controller.signal.aborted; }
  cancel() { this.controller.abort(); }
  check() { this.controller.signal.throwIfAborted(); }
  async fetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000) {
    this.check();
    const result = await boundedFetch(input, init, timeoutMs, this.controller.signal);
    this.check();
    return result;
  }
}

export async function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('네트워크 응답 시간이 초과되었습니다.', 'TimeoutError')), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); }
}
