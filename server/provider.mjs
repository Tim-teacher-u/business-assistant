import { BIZINFO_ENDPOINT, extractPage } from './normalize.mjs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export class CollectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export async function readLimited(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new CollectionError('RESPONSE_TOO_LARGE'); }
  if (!response.body) throw new CollectionError('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  let size = 0; const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new CollectionError('RESPONSE_TOO_LARGE'); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString('utf8').replace(/^\uFEFF/, '');
}
export class BizinfoProvider {
  constructor(config, { fetchImpl = fetch, sleep = delay } = {}) { this.config = config; this.fetch = fetchImpl; this.sleep = sleep; }
  async fetchPage(page) {
    const c = this.config;
    if (!c.bizinfoKey) throw new CollectionError('API_KEY_MISSING');
    const url = new URL(BIZINFO_ENDPOINT);
    url.search = new URLSearchParams({ crtfcKey: c.bizinfoKey, dataType: 'json', searchCnt: '0', pageUnit: String(c.pageSize), pageIndex: String(page) }).toString();
    for (let attempt = 0; attempt <= c.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), c.timeoutMs);
      let retry = false;
      try {
        const response = await this.fetch(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'BusinessAssistant/0.2' } });
        if (!response.ok) {
          retry = response.status === 429 || response.status >= 500;
          await response.body?.cancel();
          throw new CollectionError(response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : `HTTP_${response.status}`);
        }
        const text = await readLimited(response, c.maxBytes);
        let body;
        try { body = JSON.parse(text); } catch { throw new CollectionError('PROVIDER_NOT_JSON'); }
        try { return extractPage(body); } catch (e) { throw new CollectionError(e.message); }
      } catch (error) {
        const safe = error instanceof CollectionError ? error : new CollectionError(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
        if (!(retry || ['NETWORK_ERROR','REQUEST_TIMEOUT'].includes(safe.code)) || attempt >= c.retries) throw safe;
      } finally { clearTimeout(timer); }
      await this.sleep(Math.min(500 * 2 ** attempt, 4000));
    }
  }
  async collect({ onPage = () => {} } = {}) {
    const records = []; const fingerprints = new Set(); let expected = null;
    for (let page = 1; page <= this.config.maxPages; page++) {
      const response = await this.fetchPage(page);
      if (response.total !== null) {
        if (expected !== null && expected !== response.total) throw new CollectionError('TOTAL_CHANGED_DURING_COLLECTION');
        expected = response.total;
      }
      if (response.items.length) {
        const fingerprint = createHash('sha256').update(JSON.stringify(response.items.map(x => x?.pblancId || x?.seq || x))).digest('hex');
        if (fingerprints.has(fingerprint)) throw new CollectionError('PAGINATION_REPEATED');
        fingerprints.add(fingerprint);
      }
      records.push(...response.items);
      if (records.length > 50000) throw new CollectionError('RECORD_LIMIT');
      await onPage({ pages: page, fetched: records.length, expected });
      if (expected !== null && records.length >= expected) {
        if (records.length !== expected) throw new CollectionError('TOTAL_MISMATCH');
        return { records, pages: page, expected, complete: true };
      }
      if (response.items.length === 0 || (expected === null && response.items.length < this.config.pageSize)) {
        if (expected !== null && records.length !== expected) throw new CollectionError('INCOMPLETE_RESPONSE');
        return { records, pages: page, expected, complete: true };
      }
    }
    throw new CollectionError('PAGE_LIMIT');
  }
}
