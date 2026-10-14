// Apps Script を使わない純粋な関数を Node.js でテストする: node tests/run.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const srcDir = path.join(__dirname, '..', 'src');
const code = fs.readdirSync(srcDir).filter((f) => f.endsWith('.gs')).sort()
  .map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
const ctx = vm.createContext({ console });
vm.runInContext(code + '\nthis.exports = { parseCommand_, parseResultArgs_, splitNames_, toHalfWidth_, addDays_, formatDate_, formatWhen_, parseQuery_, buildQuery_, buildTallyText_, countAttendance_, eventBubble_, buildRecordsText_ };', ctx);
const t = ctx.exports;

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('コマンド: 1語目が完全一致したときだけ反応', () => {
  assert.deepStrictEqual(plain(t.parseCommand_('予定')), { name: 'events', args: '' });
  assert.deepStrictEqual(plain(t.parseCommand_('結果　100m　15.2秒')), { name: 'result', args: '100m　15.2秒' });
  assert.deepStrictEqual(plain(t.parseCommand_('ＨＥＬＰ')), { name: 'help', args: '' });
  assert.strictEqual(t.parseCommand_('結果どうだった？'), null);
  assert.strictEqual(t.parseCommand_('明日の予定は？'), null);
});

test('名前の分割', () => {
  assert.deepStrictEqual(plain(t.splitNames_('たろう　はなこ、じろう,さぶろう')), ['たろう', 'はなこ', 'じろう', 'さぶろう']);
  assert.deepStrictEqual(plain(t.splitNames_('')), []);
});

test('結果: 子ども1人なら名前省略可', () => {
  assert.deepStrictEqual(plain(t.parseResultArgs_('１００ｍ　１５．２秒 自己ベスト', ['たろう'])),
    { child: 'たろう', item: '100m', record: '15.2秒', note: '自己ベスト' });
});

test('結果: きょうだいは名前が必要', () => {
  assert.ok(t.parseResultArgs_('100m 15.2', ['たろう', 'はなこ']).error);
  assert.strictEqual(t.parseResultArgs_('はなこ 走り幅跳び 3m20', ['たろう', 'はなこ']).child, 'はなこ');
  assert.ok(t.parseResultArgs_('100m', ['たろう']).error);
  assert.ok(t.parseResultArgs_('100m 15.2', []).error);
});

test('日付', () => {
  assert.strictEqual(t.addDays_('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(t.addDays_('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(t.formatDate_('2026-10-18'), '10/18(日)');
  assert.strictEqual(t.formatWhen_({ '日付': '2026-10-18', '開始': '09:00', '終了': '12:00' }), '10/18(日) 9:00〜12:00');
  assert.strictEqual(t.formatWhen_({ '日付': '2026-10-18', '開始': '終日', '終了': '' }), '10/18(日)');
});

test('postback データの往復', () => {
  const q = t.buildQuery_({ a: 'att', e: 'abc', s: 'yes', c: 'たろう' });
  assert.ok(q.length < 300);
  assert.deepStrictEqual(plain(t.parseQuery_(q)), { a: 'att', e: 'abc', s: 'yes', c: 'たろう' });
});

test('出欠集計と未回答', () => {
  const ev = { eventKey: 'k', '日付': '2026-10-18', '開始': '09:00', '終了': '', 'タイトル': '記録会' };
  const rows = [{ '子ども': 'たろう', '回答': '出席' }, { '子ども': 'はなこ', '回答': '欠席' }];
  const text = t.buildTallyText_(ev, rows, ['たろう', 'はなこ', 'じろう']);
  assert.ok(text.includes('出席(1): たろう'));
  assert.ok(text.includes('欠席(1): はなこ'));
  assert.ok(text.includes('未回答(1): じろう'));
  assert.deepStrictEqual(plain(t.countAttendance_(rows)), { yes: 1, no: 1, maybe: 0 });
});

test('出欠カードのボタン', () => {
  const b = t.eventBubble_({ eventKey: 'k', '日付': '2026-10-18', '開始': '終日', 'タイトル': '大会', '場所': '競技場' }, { yes: 0, no: 0, maybe: 0 });
  assert.deepStrictEqual(plain(b.footer.contents.map((c) => c.action.label)), ['出席', '欠席', '未定']);
});

test('記録一覧は新しい順', () => {
  const rows = [
    { '子ども': 'たろう', '種目': '100m', '記録': '16.0', '大会・練習': '', '日時': '2026-09-01 10:00:00', 'メモ': '' },
    { '子ども': 'たろう', '種目': '100m', '記録': '15.2', '大会・練習': '2026-10-18 記録会', '日時': '2026-10-18 12:00:00', 'メモ': '' },
  ];
  const lines = t.buildRecordsText_('たろう', rows).split('\n');
  assert.ok(lines[1].includes('15.2'));
  assert.ok(lines[2].includes('2026-09-01'));
  assert.ok(t.buildRecordsText_('じろう', rows).includes('まだありません'));
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
