/**
 * LINE からの Webhook を受け取る。
 * Apps Script ではリクエストヘッダー（署名）を読めないため、
 * Webhook URL に付けた ?token=... が一致するリクエストだけを処理する。
 */
function doPost(e) {
  if (!e || !e.parameter || e.parameter.token !== prop_('WEBHOOK_TOKEN')) return ok_();
  const body = JSON.parse(e.postData.contents);
  (body.events || []).forEach((ev) => {
    try {
      if (isDuplicate_(ev)) return;
      handleEvent_(ev);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
    }
  });
  return ok_();
}

function ok_() {
  return ContentService.createTextOutput('OK');
}

/** LINE の再送で同じイベントを二重に処理しないようにする */
function isDuplicate_(ev) {
  if (!ev.webhookEventId) return false;
  const cache = CacheService.getScriptCache();
  if (cache.get(ev.webhookEventId)) return true;
  cache.put(ev.webhookEventId, '1', 3600);
  return false;
}

function handleEvent_(ev) {
  const source = ev.source || {};

  if (ev.type === 'join') {
    if (source.type === 'group') {
      if (!prop_('GROUP_ID')) setProp_('GROUP_ID', source.groupId);
      reply_(ev.replyToken, [text_('招待ありがとうございます！\n\n' + HELP_TEXT)]);
    }
    return;
  }

  // 登録済みのグループ以外のグループからは反応しない（1対1のトークはOK）
  const groupId = prop_('GROUP_ID');
  if (source.type === 'group' && groupId && source.groupId !== groupId) return;
  if (source.type === 'room') return;
  if (!source.userId) return;

  if (ev.type === 'message' && ev.message.type === 'text') return handleText_(ev);
  if (ev.type === 'message' && ev.message.type === 'image' && source.type === 'group') return handleImage_(ev);
  if (ev.type === 'postback') {
    const params = parseQuery_(ev.postback.data);
    if (params.a === 'att') return handleAttendancePostback_(ev, params);
  }
}

/**
 * 毎朝トリガーで実行：カレンダー同期。
 * AUTO_PUSH がオンのときだけ、変更・中止のお知らせ → 新しい予定の案内 → 未回答リマインドを流す。
 * プッシュメッセージは無料枠の通数を使うので、送る内容を1回のリクエストにまとめる。
 */
function dailyJob() {
  const sync = syncCalendar_();
  if (!CONFIG.AUTO_PUSH) return;
  const groupId = prop_('GROUP_ID');
  if (!groupId) {
    console.warn('GROUP_ID が未設定です。Bot をグループに招待してください');
    return;
  }

  const messages = [];
  const notices = [];
  sync.changed.forEach((e) => notices.push('🔄 変更：' + formatWhen_(e) + ' ' + e['タイトル'] + (e['場所'] ? '（' + e['場所'] + '）' : '')));
  sync.cancelled.forEach((e) => notices.push('❌ 中止：' + formatDate_(e['日付']) + ' ' + e['タイトル']));
  if (notices.length) messages.push(text_('予定のお知らせ\n' + notices.join('\n')));

  const upcoming = upcomingEvents_(CONFIG.ANNOUNCE_DAYS_AHEAD);
  const toAnnounce = upcoming.filter((e) => !e['案内済み']);
  if (toAnnounce.length) {
    messages.push(text_('📣 新しい予定です。出欠ボタンを押してください。'));
    messages.push(eventsCarousel_(toAnnounce, '新しい予定の出欠確認'));
  }

  const toRemind = CONFIG.REMIND_DAYS_BEFORE > 0
    ? upcoming.filter((e) => e['日付'] === addDays_(today_(), CONFIG.REMIND_DAYS_BEFORE) && !e['リマインド済み'])
    : [];
  if (toRemind.length) {
    const children = allChildren_();
    const attendance = readRows_(SHEETS.ATTENDANCE);
    const text = toRemind
      .map((e) => buildTallyText_(e, attendance.filter((a) => a.eventKey === e.eventKey), children))
      .join('\n\n');
    messages.push(text_('⏰ 出欠の確認です。未回答の方は「予定」と送ってボタンから回答してください。\n\n' + text));
  }

  if (!messages.length) return;
  push_(groupId, messages.slice(0, 5));

  toAnnounce.forEach((e) => {
    e['案内済み'] = now_();
    updateRow_(SHEETS.EVENTS, e);
  });
  toRemind.forEach((e) => {
    e['リマインド済み'] = now_();
    updateRow_(SHEETS.EVENTS, e);
  });
}

/**
 * 最初に1回だけ手動で実行する。
 * スプレッドシート・写真フォルダ・Webhook 用トークン・毎朝のトリガーを用意する。
 */
function setup() {
  requireProp_('LINE_CHANNEL_ACCESS_TOKEN');
  requireProp_('CALENDAR_ID');

  if (!prop_('SPREADSHEET_ID')) {
    setProp_('SPREADSHEET_ID', SpreadsheetApp.create('陸上クラブ 出欠・記録').getId());
  }
  Object.keys(SHEETS).forEach((k) => sheet_(SHEETS[k]));
  const defaultSheet = ss_().getSheetByName('シート1') || ss_().getSheetByName('Sheet1');
  if (defaultSheet && ss_().getSheets().length > 1) ss_().deleteSheet(defaultSheet);

  if (!prop_('PHOTO_FOLDER_ID')) {
    setProp_('PHOTO_FOLDER_ID', DriveApp.createFolder('陸上クラブ 写真').getId());
  }
  if (!prop_('WEBHOOK_TOKEN')) {
    setProp_('WEBHOOK_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }

  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'dailyJob')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(CONFIG.DAILY_HOUR).create();

  syncCalendar_();

  console.log('スプレッドシート: ' + ss_().getUrl());
  console.log('写真フォルダ: ' + photoFolderUrl_());
  console.log('Webhook URL: <ウェブアプリのURL>?token=' + prop_('WEBHOOK_TOKEN'));
}

/** 動作確認用：カレンダーをすぐ同期する */
function syncNow() {
  console.log(JSON.stringify(syncCalendar_()));
}
