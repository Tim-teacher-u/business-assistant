import { createHash } from 'node:crypto';
export const BIZINFO_ENDPOINT = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
export const REGIONS = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function plainText(value, limit = 100000) {
  if (value == null || typeof value === 'object') return '';
  return String(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, body) => {
      if (body[0] !== '#') return entities[body.toLowerCase()] || whole;
      const n = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}
export function isDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v;
}
export function parsePeriod(text) {
  const matches = [...String(text).matchAll(/(20\d{2})[.\-/]?(\d{2})[.\-/]?(\d{2})/g)].map(m => `${m[1]}-${m[2]}-${m[3]}`);
  if (matches.length === 2 && matches.every(isDate) && matches[0] <= matches[1]) return { startsOn: matches[0], endsOn: matches[1], datePrecision: 'day' };
  return { startsOn: null, endsOn: null, datePrecision: 'unknown' };
}
export function publicUrl(value, { official = false } = {}) {
  try {
    const raw = String(value || '');
    const url = new URL(raw.startsWith('/') ? 'https://www.bizinfo.go.kr' + raw : raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    if (official && !(url.hostname === 'bizinfo.go.kr' || url.hostname.endsWith('.bizinfo.go.kr'))) return '';
    return url.href;
  } catch { return ''; }
}
export function sanitizeRaw(raw, secret = '') {
  if (Array.isArray(raw)) return raw.map(item => sanitizeRaw(item, secret));
  if (raw && typeof raw === 'object') return Object.fromEntries(Object.entries(raw)
    .filter(([key]) => !/^(crtfcKey|serviceKey|apiKey|accessToken|authorization|password|__proto__|constructor|prototype)$/i.test(key))
    .map(([key, value]) => [key, sanitizeRaw(value, secret)]));
  if (typeof raw === 'string' && secret) return raw.split(secret).join('[REDACTED]');
  return raw;
}
export function extractPage(body) {
  if (!body || typeof body !== 'object') throw new Error('PROVIDER_FORMAT');
  const header = body.response?.header;
  if (header?.resultCode != null && !['0','00','NORMAL_SERVICE'].includes(String(header.resultCode))) throw new Error('PROVIDER_REJECTED');
  let items = Array.isArray(body) ? body : body.jsonArray?.item ?? body.jsonArray ?? body.items ?? body.item;
  if (items && !Array.isArray(items) && typeof items === 'object' && (items.pblancId || items.seq)) items = [items];
  if (!Array.isArray(items)) throw new Error('PROVIDER_FORMAT');
  const values = [body.totalCount, body.totCnt, body.jsonArray?.totalCount, body.jsonArray?.totCnt, items[0]?.totCnt];
  const totalValue = values.find(v => v != null && v !== '' && /^\d+$/.test(String(v)));
  const total = totalValue == null ? null : Number(totalValue);
  if (total !== null && (!Number.isSafeInteger(total) || total > 1000000)) throw new Error('PROVIDER_COUNT');
  return { items, total };
}
export function normalizeBizinfo(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('INVALID_RECORD');
  const sourceId = String(item.pblancId || item.seq || '');
  if (!/^PBLN_[A-Za-z0-9_-]{1,90}$/.test(sourceId)) throw new Error('INVALID_ID');
  const title = plainText(item.pblancNm || item.title, 500);
  const sourceUrl = publicUrl(item.pblancUrl || item.link, { official: true });
  if (!title || !sourceUrl) throw new Error('MISSING_TITLE_OR_OFFICIAL_URL');
  const periodText = plainText(item.reqstBeginEndDe || item.reqstDt, 300) || '기간 원문 확인';
  const attachments = [];
  for (const [urlKey, nameKey, role] of [['flpthNm','fileNm','attachment'], ['printFlpthNm','printFileNm','notice']]) {
    const url = publicUrl(item[urlKey]);
    if (url && !attachments.some(a => a.url === url)) attachments.push({ name: plainText(item[nameKey], 500) || '첨부파일', url, role, extractionStatus: 'not_downloaded' });
  }
  const tags = plainText(item.hashTags, 3000).split(/[,\s]+/).filter(Boolean);
  const prefix = title.match(/^\[([^\]]+)\]/)?.[1] || '';
  const regionCandidates = REGIONS.filter(r => tags.includes(r) || prefix.split(/[ㆍ·,\s]+/).includes(r));
  const record = {
    provider: 'bizinfo', sourceId, title, sourceUrl,
    agency: plainText(item.jrsdInsttNm || item.author, 500),
    executor: plainText(item.excInsttNm, 500),
    category: plainText(item.pldirSportRealmLclasCodeNm || item.lcategory, 200),
    bodyText: plainText(item.bsnsSumryCn || item.description),
    targetText: plainText(item.trgetNm, 3000),
    applicationMethod: plainText(item.reqstMthPapersCn, 5000),
    applicationUrl: publicUrl(item.rceptEngnHmpgUrl),
    contactText: plainText(item.refrncNm, 3000),
    periodText, ...parsePeriod(periodText),
    publishedAt: plainText(item.creatPnttm || item.pubDate, 100),
    tags: [...new Set(tags)].sort(), regionCandidates, attachments,
    // Tags are discovery hints, never certified eligibility or a final region restriction.
    analysisStatus: 'pending', supportType: 'unknown', eligibility: null,
  };
  record.contentHash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
  return record;
}
