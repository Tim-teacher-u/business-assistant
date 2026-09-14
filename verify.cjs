const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const pure = script.slice(0, script.indexOf('// CORE_END'));
const sandbox = { URL, Date, Intl, Object, Number, String, Infinity };
vm.createContext(sandbox);
vm.runInContext(pure + '\nthis.api = {BUILTIN, compareProgram, periodState, parsePeriod, validDate, officialUrl, dateDiff};', sandbox);
const { BUILTIN, compareProgram, periodState, parsePeriod, validDate, officialUrl, dateDiff } = sandbox.api;
const today = '2026-09-10';
const cafe = { region: '서울', district: '마포구', industry: 'cafe', opened: '2023-09-01', employees: 2, revenue: 20000, age: 48, active: 'yes', certificate: 'yes', store: 'yes', insurance: 'unknown' };
const byRule = rule => BUILTIN.find(p => p.rule === rule);
const tests = [];
function test(name, fn) { fn(); tests.push(name); console.log('PASS ' + name); }
test('JavaScript parses and official seed IDs are unique', () => {
  assert.equal(BUILTIN.length, 5);
  assert.equal(new Set(BUILTIN.map(p => p.id)).size, 5);
  for (const p of BUILTIN) assert.ok(officialUrl(p.source));
});
test('Seoul cafe excludes Ganghwa but retains national and Seoul candidates', () => {
  assert.equal(BUILTIN.filter(p => compareProgram(p, cafe, today).eligibleCandidate).length, 4);
  assert.equal(compareProgram(byRule('ganghwa'), cafe, today).excluded, true);
  assert.equal(compareProgram(byRule('seoul-loan'), cafe, today).excluded, false);
});
test('Incheon Ganghwa changes district eligibility', () => {
  const p = { ...cafe, region: '인천', district: '강화군' };
  assert.equal(compareProgram(byRule('ganghwa'), p, today).excluded, false);
  assert.equal(compareProgram(byRule('seoul-loan'), p, today).excluded, true);
  assert.equal(compareProgram(byRule('ganghwa'), { ...p, district: '부평구' }, today).excluded, true);
  assert.equal(compareProgram(byRule('ganghwa'), { ...p, district: '' }, today).checks.find(c => c.label === '시·군·구').state, 'unknown');
});
test('Registration cutoff is inclusive and rejects later registration', () => {
  const p = { ...cafe, region: '인천', district: '강화군' };
  assert.equal(compareProgram(byRule('ganghwa'), { ...p, opened: '2026-09-01' }, today).excluded, false);
  assert.equal(compareProgram(byRule('ganghwa'), { ...p, opened: '2026-09-02' }, today).excluded, true);
});
test('Closed business and no storefront do not become smart-store matches', () => {
  assert.equal(compareProgram(byRule('smart'), { ...cafe, store: 'no' }, today).excluded, true);
  assert.equal(compareProgram(byRule('smart'), { ...cafe, active: 'no' }, today).excluded, true);
});
test('Missing certificate and insurance remain unknown, never fabricated passes', () => {
  const result = compareProgram(byRule('insurance'), { ...cafe, certificate: 'unknown' }, today);
  assert.equal(result.checks.find(c => c.label === '소상공인 확인').state, 'unknown');
  assert.equal(result.checks.find(c => c.label === '자영업자 고용보험').state, 'unknown');
});
test('Budget-exhaustion and recruitment cutoffs are not invented as December 31', () => {
  for (const rule of ['insurance', 'seoul-loan', 'consulting']) {
    assert.equal(periodState(byRule(rule), today).code, 'unknown');
    assert.equal(byRule(rule).end, null);
  }
});
test('Deadline uses day boundaries; future and expired programs are not current candidates', () => {
  const smart = byRule('smart');
  assert.equal(periodState(smart, today).days, 20);
  assert.equal(periodState(smart, '2026-09-30').code, 'dated');
  assert.equal(periodState(smart, '2026-10-01').code, 'closed');
  assert.equal(periodState(smart, '2026-08-25').code, 'upcoming');
  assert.equal(compareProgram(smart, cafe, '2026-10-01').eligibleCandidate, false);
  assert.equal(compareProgram(smart, cafe, '2026-08-25').eligibleCandidate, false);
  assert.equal(dateDiff('2026-09-11', '2026-09-10'), 1);
});
test('Date parser accepts official formats and refuses malformed or reversed dates', () => {
  assert.equal(parsePeriod('20260826 ~ 20260930').end, '2026-09-30');
  assert.equal(parsePeriod('2026.08.26 ~ 2026.09.30').start, '2026-08-26');
  assert.equal(parsePeriod('예산 소진시까지').end, null);
  assert.equal(parsePeriod('20260930 ~ 20260826').end, null);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2028-02-29'), true);
});
test('Data URLs, script URLs and deceptive official-domain suffixes are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://bizinfo.go.kr.attacker.example/p', 'https://attacker.example/']) assert.equal(officialUrl(url), '');
  assert.ok(officialUrl('https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=ABC'));
});
test('No unsupported qualification percentage is derived from income, age or headcount', () => {
  const first = compareProgram(byRule('smart'), cafe, today);
  const second = compareProgram(byRule('smart'), { ...cafe, age: 90, employees: 9999, revenue: 999999 }, today);
  assert.equal(first.rank, second.rank);
  assert.equal(Object.hasOwn(first, 'probability'), false);
  assert.ok(first.unknown > 0);
});
console.log(`\n${tests.length} checks passed. This does not test a live API, email provider, or payment gateway.`);
