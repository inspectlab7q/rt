/**
 * カレンダーの予定に対応するキー。
 * 繰り返し予定は各回が同じ ID を持つので日付を足して区別する。
 */
function eventKey_(calEvent) {
  let base = calEvent.getId();
  if (calEvent.isRecurringEvent()) base += '|' + fmt_(calEvent.getStartTime(), 'yyyy-MM-dd');
  return md5Hex_(base).slice(0, 12);
}

function calEventToRow_(ce) {
  const allDay = ce.isAllDayEvent();
  return {
    eventKey: eventKey_(ce),
    '日付': fmt_(allDay ? ce.getAllDayStartDate() : ce.getStartTime(), 'yyyy-MM-dd'),
    '開始': allDay ? '終日' : fmt_(ce.getStartTime(), 'HH:mm'),
    '終了': allDay ? '' : fmt_(ce.getEndTime(), 'HH:mm'),
    'タイトル': ce.getTitle(),
    '場所': ce.getLocation(),
    'カレンダーID': ce.getId(),
  };
}

const EVENT_FIELDS = ['日付', '開始', '終了', 'タイトル', '場所'];

/**
 * Google カレンダーの予定を「予定」シートに取り込む。
 * 案内済みの予定が変更・削除された場合はそのリストを返す（グループへのお知らせ用）。
 */
function syncCalendar_() {
  const calendar = CalendarApp.getCalendarById(requireProp_('CALENDAR_ID'));
  if (!calendar) throw new Error('カレンダーが見つかりません。CALENDAR_ID と共有設定を確認してください');

  const today = today_();
  const lastDay = addDays_(today, CONFIG.SYNC_DAYS_AHEAD);
  const start = new Date(today + 'T00:00:00+09:00');
  const end = new Date(addDays_(lastDay, 1) + 'T00:00:00+09:00');

  const rows = readRows_(SHEETS.EVENTS);
  const byKey = {};
  rows.forEach((r) => (byKey[r.eventKey] = r));

  const changed = [];
  const cancelled = [];
  const seen = {};

  calendar.getEvents(start, end).forEach((ce) => {
    const data = calEventToRow_(ce);
    seen[data.eventKey] = true;
    const row = byKey[data.eventKey];
    if (!row) {
      appendRow_(SHEETS.EVENTS, Object.assign(data, { '状態': '予定', '更新日時': now_() }));
      return;
    }
    const diff = EVENT_FIELDS.some((f) => row[f] !== data[f]);
    if (!diff && row['状態'] !== '中止') return;
    if (row['案内済み'] && diff) changed.push(Object.assign({}, row, data));
    // 日時が変わったらリマインドをやり直す
    const resetRemind = row['日付'] !== data['日付'];
    Object.assign(row, data, { '状態': '予定', '更新日時': now_() });
    if (resetRemind) row['リマインド済み'] = '';
    updateRow_(SHEETS.EVENTS, row);
  });

  // 期間内なのにカレンダーから消えた予定は中止扱い
  rows.forEach((r) => {
    if (seen[r.eventKey] || r['状態'] === '中止') return;
    if (r['日付'] < today || r['日付'] > lastDay) return;
    r['状態'] = '中止';
    r['更新日時'] = now_();
    updateRow_(SHEETS.EVENTS, r);
    if (r['案内済み']) cancelled.push(r);
  });

  return { changed: changed, cancelled: cancelled };
}
