/**
 * 河北SS保護者当番表（2026年8〜11月）を、カレンダーとポータルにまとめて登録する。
 *
 * 使い方：Apps Script に「当番表取り込み」というスクリプトを作ってこれを貼り、
 *         関数「importSchedule」を選んで実行する。
 * 何回実行しても重複しない（同じ日の同じ予定は上書きする）。
 * 練習の時間を変えたら、もう一度実行すれば入れ直せる。
 */

// 平日（火・木）の練習時間。夏（IMPORT_SUMMER の期間）とそれ以外（秋〜春）で分ける
const IMPORT_PRACTICE_TIME = { summer: ['18:00', '19:30'], other: ['17:00', '18:30'] };
const IMPORT_SUMMER = { from: '06-01', to: '09-30' }; // 月-日
// 土曜は日によって違うので「終日」で入れる。時間が分かっている日はここに書く
// 例）'2026-10-17': ['09:00', '11:00'],
const IMPORT_SATURDAY_TIME = {
};
// null を返すと「終日」で登録する
function importPracticeTime_(date) {
  if (new Date(date + 'T00:00:00Z').getUTCDay() === 6) return IMPORT_SATURDAY_TIME[date] || null;
  const md = date.slice(5);
  return md >= IMPORT_SUMMER.from && md <= IMPORT_SUMMER.to ? IMPORT_PRACTICE_TIME.summer : IMPORT_PRACTICE_TIME.other;
}
const IMPORT_PRACTICE_PLACE = '河北小学校 体育館';
const IMPORT_TAG = '#当番表から登録';

// [日付, 当番]
const IMPORT_PRACTICES = [
  ['2026-08-01', '白方'], ['2026-08-04', '牧田(健)'], ['2026-08-06', '山口'], ['2026-08-11', '江本'],
  ['2026-08-18', '齋藤'], ['2026-08-20', '山根'], ['2026-08-25', '野口原'], ['2026-08-27', '藤山'],
  ['2026-09-01', '西田'], ['2026-09-03', '吉川'], ['2026-09-08', '牧田(隼)'], ['2026-09-10', '山脇'],
  ['2026-09-15', '松下'], ['2026-09-17', '大場'], ['2026-09-19', '白方'], ['2026-09-22', '牧田(健)'],
  ['2026-09-24', '山口'], ['2026-09-29', '江本'],
  ['2026-10-01', '齋藤'], ['2026-10-03', '山根'], ['2026-10-06', '野口原'], ['2026-10-08', '藤山'],
  ['2026-10-13', '西田'], ['2026-10-15', '吉川'], ['2026-10-17', '牧田(隼)'], ['2026-10-20', '山脇'],
  ['2026-10-22', '松下'], ['2026-10-27', '大場'], ['2026-10-29', '白方'], ['2026-10-31', '吉川'],
  ['2026-11-03', '山口'], ['2026-11-05', '江本'], ['2026-11-07', '齋藤'], ['2026-11-10', '山根'],
  ['2026-11-12', '野口原'], ['2026-11-17', '藤山'], ['2026-11-19', '西田'], ['2026-11-21', '牧田(健)'],
  ['2026-11-24', '牧田(隼)'], ['2026-11-26', '山脇'],
];

// [日付, 大会名, 出場者, 当番, サブ当番]
const IMPORT_RACES = [
  ['2026-08-29', '第57回県ジュニア選手権大会（8/29・30）', '3年生以上', '野口原・牧田(健)', '吉川'],
  ['2026-09-05', '第2回土曜記録会', '全員', '山根・牧田(隼)', '江本'],
  ['2026-09-27', '第29回鳥取県小学生陸上競技大会', '全員', '齋藤・白方', ''],
  ['2026-10-12', '倉吉マラソン', '全員', '', ''],
  ['2026-10-18', '第4回鳥取県小学生打吹・羽衣クロスカントリー大会', '全員', '西田・大場', '松下'],
  ['2026-10-25', '第27回県民スポレク祭', '全員', '吉川・牧田(健)', ''],
  ['2026-11-08', '三朝クロスカントリー大会', '全員', '山脇・野口原', ''],
];

const IMPORT_DUTY_SHEET = { name: '当番', headers: ['日付', '種類', '当番', 'サブ', '備考', '更新日時'] };

function importSchedule() {
  requireOwner_();
  const cal = calendar_();
  const count = { practice: 0, race: 0 };

  // 1. 練習をカレンダーに入れる
  IMPORT_PRACTICES.forEach(function (p) {
    const date = p[0], duty = p[1];
    const time = importPracticeTime_(date);
    const day = new Date(date + 'T00:00:00+09:00');
    const isSat = new Date(date + 'T00:00:00Z').getUTCDay() === 6;
    const desc = '当番：' + duty + (isSat && !time ? '\n時間は日によって違います。役員からの案内を見てください' : '') + '\n' + IMPORT_TAG;
    const existing = cal.getEventsForDay(day).find(function (e) { return e.getDescription().indexOf(IMPORT_TAG) >= 0 && e.getTitle() === '練習'; });
    // 土曜の時間を、カレンダーで直接直した場合は上書きしない
    if (existing && isSat && !time) {
      existing.setLocation(IMPORT_PRACTICE_PLACE).setDescription(desc);
    } else if (time) {
      const start = new Date(date + 'T' + time[0] + ':00+09:00');
      const end = new Date(date + 'T' + time[1] + ':00+09:00');
      if (existing) existing.setTime(start, end).setLocation(IMPORT_PRACTICE_PLACE).setDescription(desc);
      else cal.createEvent('練習', start, end, { location: IMPORT_PRACTICE_PLACE, description: desc });
    } else {
      if (existing) existing.setAllDayDate(day).setLocation(IMPORT_PRACTICE_PLACE).setDescription(desc);
      else cal.createAllDayEvent('練習', day, { location: IMPORT_PRACTICE_PLACE, description: desc });
    }
    count.practice++;
  });

  // 2. 大会はポータルの「大会をつくる」と同じ仕組みで登録する（カレンダーにも入る）
  syncCalendar_();
  const ctx = { userId: '', name: '当番表の取り込み', admin: true };
  IMPORT_RACES.forEach(function (r) {
    const date = r[0], title = r[1], target = r[2], duty = r[3], sub = r[4];
    const ev = readRows_(SHEETS.EVENTS).find(function (e) { return e['日付'] === date && e['タイトル'] === title && e['状態'] !== '中止'; });
    const old = ev ? readRows_(SHEETS.RACES).find(function (x) { return x.eventKey === ev.eventKey; }) : null;
    const d = old ? raceToObj_(old) : null;
    const dutyNote = duty ? '当番：' + duty + (sub ? '（サブ：' + sub + '）' : '') : '当番：なし';
    saveRaceAction_(ctx, {
      key: ev ? ev.eventKey : '',
      title: title,
      date: date,
      place: ev ? ev['場所'] : '',
      type: /記録会/.test(title) ? '記録会' : '大会',
      target: target,
      fee: d ? d.fee : 0,
      deadline: d ? d.deadline : '',
      meetTime: d ? d.meetTime : '',
      meetPlace: d ? d.meetPlace : '',
      races: d ? d.races : [],
      items: d ? d.items : ['ユニフォーム', 'アスリートビブス', '水筒'],
      notes: d && d.notes ? d.notes : dutyNote,
    });
    count.race++;
  });

  // 3. 当番の一覧を「当番」シートに残す（あとで当番表の機能で使う）
  withLock_(function () {
    const rows = readRows_(IMPORT_DUTY_SHEET);
    const put = function (data) {
      const row = rows.find(function (x) { return x['日付'] === data['日付'] && x['種類'] === data['種類']; });
      if (row) updateRow_(IMPORT_DUTY_SHEET, Object.assign(row, data));
      else rows.push(appendRow_(IMPORT_DUTY_SHEET, data));
    };
    IMPORT_PRACTICES.forEach(function (p) { put({ '日付': p[0], '種類': '練習', '当番': p[1], 'サブ': '', '備考': '', '更新日時': now_() }); });
    IMPORT_RACES.forEach(function (r) { put({ '日付': r[0], '種類': '試合', '当番': r[3] || 'なし', 'サブ': r[4], '備考': r[1], '更新日時': now_() }); });
  });

  syncCalendar_();
  console.log('練習 ' + count.practice + '件・大会 ' + count.race + '件を登録しました。ポータルで「更新」を押すと表示されます。');
}
