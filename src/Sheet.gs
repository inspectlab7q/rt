/**
 * スプレッドシートを簡易データベースとして使う。
 * どのシートも1行目が見出しで、2行目以降がデータ。値はすべて文字列で保存する。
 */
const SHEETS = {
  FAMILIES: { name: '家族', headers: ['userId', '表示名', '子ども', '更新日時'] },
  EVENTS: {
    name: '予定',
    headers: ['eventKey', '日付', '開始', '終了', 'タイトル', '場所', 'カレンダーID', '状態', '案内済み', 'リマインド済み', '更新日時'],
  },
  ATTENDANCE: { name: '出欠', headers: ['eventKey', '日付', 'タイトル', '子ども', '回答', 'userId', '表示名', '更新日時'] },
  PHOTOS: { name: '写真', headers: ['日時', 'eventKey', '予定', 'userId', '表示名', 'ファイル名', 'URL'] },
  RESULTS: { name: '結果', headers: ['日時', 'eventKey', '大会・練習', '子ども', '種目', '記録', 'メモ', 'userId', '表示名'] },
};

let ss__ = null;

function ss_() {
  if (!ss__) ss__ = SpreadsheetApp.openById(requireProp_('SPREADSHEET_ID'));
  return ss__;
}

function sheet_(def) {
  const ss = ss_();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 手入力で日付や時刻に自動変換されたセルも文字列に戻す */
function cellToString_(v, header) {
  if (v instanceof Date) {
    if (header.indexOf('日時') >= 0) return fmt_(v, 'yyyy-MM-dd HH:mm:ss');
    if (header === '開始' || header === '終了' || header === '記録') return fmt_(v, 'H:mm');
    return fmt_(v, 'yyyy-MM-dd');
  }
  return v === null || v === undefined ? '' : String(v);
}

/** 全行をオブジェクトの配列で返す。_row に行番号が入る */
function readRows_(def) {
  const sh = sheet_(def);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, def.headers.length).getValues();
  return values
    .map((r, i) => {
      const o = { _row: i + 2 };
      def.headers.forEach((h, j) => (o[h] = cellToString_(r[j], h)));
      return o;
    })
    .filter((o) => def.headers.some((h) => o[h] !== ''));
}

function toValues_(def, obj) {
  return def.headers.map((h) => (obj[h] === null || obj[h] === undefined ? '' : String(obj[h])));
}

function appendRow_(def, obj) {
  const sh = sheet_(def);
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  // 書式を文字列にしてから書き込み、「3:20」などが時刻に化けるのを防ぐ
  sh.getRange(row, 1, 1, def.headers.length).setNumberFormat('@').setValues([toValues_(def, obj)]);
  obj._row = row;
  return obj;
}

function updateRow_(def, obj) {
  sheet_(def).getRange(obj._row, 1, 1, def.headers.length).setNumberFormat('@').setValues([toValues_(def, obj)]);
}

/** 複数人が同時にボタンを押しても行が重複しないようにロックして実行する */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---- 家族（LINE ユーザー ↔ 子どもの名前） ----

function findFamily_(userId) {
  return readRows_(SHEETS.FAMILIES).find((f) => f.userId === userId) || null;
}

function childrenOf_(family) {
  return family ? splitNames_(family['子ども']) : [];
}

function allChildren_() {
  const names = [];
  readRows_(SHEETS.FAMILIES).forEach((f) => {
    childrenOf_(f).forEach((c) => {
      if (names.indexOf(c) < 0) names.push(c);
    });
  });
  return names;
}

function saveFamily_(userId, displayName, children) {
  return withLock_(() => {
    const f = findFamily_(userId);
    const data = { userId: userId, '表示名': displayName, '子ども': children.join(','), '更新日時': now_() };
    if (f) {
      updateRow_(SHEETS.FAMILIES, Object.assign(f, data));
    } else {
      appendRow_(SHEETS.FAMILIES, data);
    }
  });
}

// ---- 予定 ----

function findEvent_(eventKey) {
  return readRows_(SHEETS.EVENTS).find((e) => e.eventKey === eventKey) || null;
}

/** 今日以降の中止でない予定を日付順に */
function upcomingEvents_(days) {
  const from = today_();
  const to = addDays_(from, days);
  return readRows_(SHEETS.EVENTS)
    .filter((e) => e['状態'] !== '中止' && e['日付'] >= from && e['日付'] <= to)
    .sort(compareEvents_);
}

/** 指定日から lookbackDays 日前までで、いちばん新しい予定（写真・結果の紐づけ用） */
function recentEvent_(dateStr, lookbackDays) {
  const from = addDays_(dateStr, -lookbackDays);
  const list = readRows_(SHEETS.EVENTS)
    .filter((e) => e['状態'] !== '中止' && e['日付'] >= from && e['日付'] <= dateStr)
    .sort(compareEvents_);
  return list.length ? list[list.length - 1] : null;
}

function compareEvents_(a, b) {
  const ka = a['日付'] + ' ' + (a['開始'] === '終日' ? '' : a['開始']);
  const kb = b['日付'] + ' ' + (b['開始'] === '終日' ? '' : b['開始']);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

// ---- 出欠 ----

function attendanceFor_(eventKey) {
  return readRows_(SHEETS.ATTENDANCE).filter((a) => a.eventKey === eventKey);
}

function saveAttendance_(ev, child, status, userId, displayName) {
  withLock_(() => {
    const rows = readRows_(SHEETS.ATTENDANCE);
    const existing = rows.find((a) => a.eventKey === ev.eventKey && a['子ども'] === child);
    const data = {
      eventKey: ev.eventKey,
      '日付': ev['日付'],
      'タイトル': ev['タイトル'],
      '子ども': child,
      '回答': STATUS[status],
      userId: userId,
      '表示名': displayName,
      '更新日時': now_(),
    };
    if (existing) {
      updateRow_(SHEETS.ATTENDANCE, Object.assign(existing, data));
    } else {
      appendRow_(SHEETS.ATTENDANCE, data);
    }
  });
}
