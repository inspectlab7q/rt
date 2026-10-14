// サーバー側のテスト（Apps Script のサービスはメモリ上のまねで動かす）: node tests/run.js
const assert = require('assert');
const { createGas } = require('./gas-mock');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e.stack || e.message)); }
}
const plain = (x) => JSON.parse(JSON.stringify(x));

function setupClub() {
  const gas = createGas();
  gas.init();
  const jst = (s) => new Date(s + '+09:00');
  gas.calendar.add({ title: '通常練習', start: jst('2026-10-15T17:00:00'), end: jst('2026-10-15T18:30:00'), location: '第二小学校' });
  gas.calendar.add({ title: '通常練習', start: jst('2026-10-17T09:00:00'), end: jst('2026-10-17T11:00:00'), location: '市民グラウンド' });
  gas.calendar.add({ title: '秋季記録会', start: jst('2026-11-01T00:00:00'), end: jst('2026-11-02T00:00:00'), allDay: true, location: '市営陸上競技場' });
  gas.profiles.U1 = '山田';
  gas.profiles.U2 = '鈴木';
  return gas;
}
const dm = (userId) => ({ type: 'user', userId });
const group = (userId) => ({ type: 'group', groupId: 'G1', userId });
const keyOf = (text) => (text.match(/\?k=([A-Za-z0-9]+)/) || [])[1];

test('コマンド: 1語目が完全一致したときだけ反応', () => {
  const gas = createGas();
  assert.deepStrictEqual(plain(gas.run("parseCommand_('ポータル 再発行')")), { name: 'portal', args: '再発行' });
  assert.deepStrictEqual(plain(gas.run("parseCommand_('結果　100m　15.2秒')")), { name: 'result', args: '100m　15.2秒' });
  assert.strictEqual(gas.run("parseCommand_('予定は？')"), null);
  assert.strictEqual(gas.run("parseCommand_('結果どうだった？')"), null);
});

test('子どもの登録文を名前と学年に分ける', () => {
  const gas = createGas();
  assert.deepStrictEqual(plain(gas.run("parseChildrenArgs_('山田たろう 3年 山田はなこ１年')")), [{ name: '山田たろう', grade: 3 }, { name: '山田はなこ', grade: 1 }]);
  assert.deepStrictEqual(plain(gas.run("parseChildrenArgs_('たろう、はなこ（2年）')")), [{ name: 'たろう', grade: 0 }, { name: 'はなこ', grade: 2 }]);
});

test('対象学年の判定', () => {
  const gas = createGas();
  assert.strictEqual(gas.run("inTarget_('4年生以上', 3)"), false);
  assert.strictEqual(gas.run("inTarget_('4年生以上', 5)"), true);
  assert.strictEqual(gas.run("inTarget_('全員', 1)"), true);
});

test('Botで登録して、ポータルのリンクは1対1でだけ渡す', () => {
  const gas = setupClub();
  const r1 = gas.line(dm('U1'), '登録 山田たろう 3年 山田はなこ 1年');
  assert.ok(r1.includes('山田たろう（3年）'), r1);
  const inGroup = gas.line(group('U1'), 'ポータル');
  assert.ok(!keyOf(inGroup), 'グループに個人リンクを出さない');
  const k1 = keyOf(gas.line(dm('U1'), 'ポータル'));
  assert.ok(k1 && k1.length === 32);
  assert.strictEqual(keyOf(gas.line(dm('U1'), 'ポータル')), k1, '同じリンクを返す');
  const k2 = keyOf(gas.line(dm('U1'), 'ポータル 再発行'));
  assert.ok(k2 && k2 !== k1, '再発行で変わる');
  assert.throws(() => gas.ctx.api(k1, 'bootstrap'), /リンクが無効/);
  const children = gas.rows('子ども');
  assert.deepStrictEqual(children.map((c) => [c['名前'], c['学年'], c['保護者userId']]), [['山田たろう', '3', 'U1'], ['山田はなこ', '1', 'U1']]);
});

test('ポータル: 予定の取り込み・エントリー・締切・集金', () => {
  const gas = setupClub();
  gas.line(dm('U1'), '登録 山田たろう 3年');
  gas.line(dm('U2'), '登録 鈴木けんた 5年');
  const kAdmin = keyOf(gas.line(dm('U1'), 'ポータル'));
  const kParent = keyOf(gas.line(dm('U2'), 'ポータル'));
  gas.sheet('家族').data.forEach((r) => { if (r[0] === 'U1') r[3] = '○'; });

  let st = gas.ctx.api(kParent, 'bootstrap');
  assert.strictEqual(st.me.admin, false);
  assert.deepStrictEqual(plain(st.me.children), [{ name: '鈴木けんた', grade: 5 }]);
  const race = st.events.find((e) => e.title === '秋季記録会');
  assert.strictEqual(race.type, '大会', '予定名から大会と判断');
  assert.strictEqual(st.events.filter((e) => e.type === '練習').length, 2);

  assert.throws(() => gas.ctx.api(kParent, 'saveRace', { title: 'x', date: '2026-11-01' }), /役員だけ/);
  st = gas.ctx.api(kAdmin, 'saveRace', { key: race.key, title: '秋季記録会', date: '2026-11-01', place: '市営陸上競技場', target: '4年生以上', fee: 500, deadline: '2026-10-22', races: ['100m', '走り幅跳び'], items: ['水筒'], meetTime: '7:50' });
  assert.strictEqual(st.events.find((e) => e.key === race.key).detail.target, '4年生以上');

  assert.throws(() => gas.ctx.api(kParent, 'saveEntry', { key: race.key, child: '山田たろう', join: '参加', races: [] }), /登録されていません/);
  st = gas.ctx.api(kParent, 'saveEntry', { key: race.key, child: '鈴木けんた', join: '参加', races: ['100m', '砲丸投げ'] });
  assert.deepStrictEqual(plain(st.entries[0].races), ['100m'], '大会にない種目は入れない');
  st = gas.ctx.api(kParent, 'saveEntry', { key: race.key, child: '鈴木けんた', join: '参加', races: ['100m', '走り幅跳び'] });
  assert.strictEqual(gas.rows('エントリー').length, 1, '同じ子は上書き');

  st = gas.ctx.api(kAdmin, 'setPaid', { key: race.key, child: '鈴木けんた', paid: true });
  assert.strictEqual(st.entries[0].paid, true);

  gas.ctx.api(kAdmin, 'saveRace', { key: race.key, title: '秋季記録会', date: '2026-11-01', place: '市営陸上競技場', target: '4年生以上', fee: 500, deadline: '2026-10-13', races: ['100m'] });
  assert.throws(() => gas.ctx.api(kParent, 'saveEntry', { key: race.key, child: '鈴木けんた', join: '不参加' }), /締切/);
  gas.ctx.api(kAdmin, 'saveEntry', { key: race.key, child: '鈴木けんた', join: '不参加' });
  assert.strictEqual(gas.rows('エントリー')[0]['回答'], '不参加', '役員は締切後も直せる');
});

test('ポータル: 大会を新しく作るとカレンダーにも入る', () => {
  const gas = setupClub();
  gas.line(dm('U1'), '登録 山田たろう 3年');
  const k = keyOf(gas.line(dm('U1'), 'ポータル'));
  gas.sheet('家族').data.forEach((r) => { if (r[0] === 'U1') r[3] = '○'; });
  const st = gas.ctx.api(k, 'saveRace', { title: '冬季ロードレース大会', date: '2026-11-22', place: '東中学校', races: ['2km'] });
  assert.ok(st.message.includes('保存'));
  const ce = gas.calendar.events.find((e) => e.title === '冬季ロードレース大会');
  assert.ok(ce && ce.allDay && ce.location === '東中学校');
  const ev = st.events.find((e) => e.title === '冬季ロードレース大会');
  assert.strictEqual(ev.date, '2026-11-22');
  gas.ctx.api(k, 'saveRace', { key: ev.key, title: '冬季ロードレース大会', date: '2026-11-29', place: '東中学校' });
  assert.strictEqual(gas.ctx.Utilities.formatDate(ce.start, 'Asia/Tokyo', 'yyyy-MM-dd'), '2026-11-29', '日付を直すとカレンダーも動く');
  gas.ctx.api(k, 'refresh');
  assert.strictEqual(gas.rows('予定').filter((r) => r['タイトル'] === '冬季ロードレース大会').length, 1, '同期しても重複しない');
});

test('ポータル: 休みの連絡は役員に届き、他の保護者には見えない', () => {
  const gas = setupClub();
  gas.line(dm('U1'), '登録 山田たろう 3年');
  gas.line(dm('U2'), '登録 鈴木けんた 5年');
  gas.line(dm('U3'), '登録 佐藤さくら 2年');
  const kAdmin = keyOf(gas.line(dm('U1'), 'ポータル'));
  const kParent = keyOf(gas.line(dm('U2'), 'ポータル'));
  const kOther = keyOf(gas.line(dm('U3'), 'ポータル'));
  gas.sheet('家族').data.forEach((r) => { if (r[0] === 'U1') r[3] = '○'; });

  assert.throws(() => gas.ctx.api(kParent, 'reportAbsence', { child: '鈴木けんた', date: '2026-10-01', reason: '体調不良' }), /過ぎた日/);
  let st = gas.ctx.api(kParent, 'reportAbsence', { child: '鈴木けんた', date: '2026-10-15', reason: '家の都合', memo: '通院' });
  assert.strictEqual(st.absences.length, 1);
  const push = gas.pushes().pop();
  assert.strictEqual(push.payload.to, 'U1');
  assert.ok(push.payload.messages[0].text.includes('鈴木けんた'));
  assert.strictEqual(gas.ctx.api(kOther, 'bootstrap').absences.length, 0, '他の家庭の休みは見えない');

  st = gas.ctx.api(kAdmin, 'ackAbsence', { id: st.absences[0].id });
  assert.strictEqual(st.absences[0].ack, true);
  assert.throws(() => gas.ctx.api(kOther, 'cancelAbsence', { id: st.absences[0].id }), /見つかりません/);
  st = gas.ctx.api(kParent, 'cancelAbsence', { id: st.absences[0].id });
  assert.strictEqual(st.absences.length, 0);
});

test('ポータル: わが家で子どもを直す・両親で同じ子を登録', () => {
  const gas = setupClub();
  gas.line(dm('U1'), '登録 山田たろう');
  gas.line(dm('U4'), '登録 山田たろう 3年');
  const k = keyOf(gas.line(dm('U1'), 'ポータル'));
  assert.strictEqual(gas.rows('子ども').length, 1);
  assert.strictEqual(gas.rows('子ども')[0]['保護者userId'], 'U1,U4');
  let st = gas.ctx.api(k, 'saveChildren', { children: [{ name: '山田たろう', grade: 4 }, { name: '山田はなこ', grade: 1 }] });
  assert.deepStrictEqual(plain(st.me.children), [{ name: '山田たろう', grade: 4 }, { name: '山田はなこ', grade: 1 }]);
  st = gas.ctx.api(k, 'saveChildren', { children: [{ name: '山田はなこ', grade: 1 }] });
  assert.deepStrictEqual(st.kids.map((c) => c.name), ['山田たろう', '山田はなこ'], 'もう一人の親が登録しているので残る');
});

test('ポータル画面: 個人キーだけを埋め込む', () => {
  const gas = setupClub();
  const html = gas.ctx.doGet({ parameter: { k: 'abc"</script><script>alert(1)' } }).getContent();
  assert.ok(html.includes('var KEY = "";'), '不正なキーは空にする');
  const ok = gas.ctx.doGet({ parameter: { k: 'A'.repeat(32) } }).getContent();
  assert.ok(ok.includes('var KEY = "' + 'A'.repeat(32) + '";'));
});

test('管理用の関数はWebアプリからは動かない', () => {
  const gas = setupClub();
  assert.throws(() => gas.ctx.setup(), /持ち主/);
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
