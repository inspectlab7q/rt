const HELP_TEXT = [
  '🏃 陸上クラブBotの使い方',
  '',
  '登録 名前 … お子さんの名前を登録（きょうだいは「登録 たろう はなこ」）',
  '予定 … これからの予定と出欠ボタンを表示',
  '出欠 … 直近の予定の出欠一覧（未回答者も表示）',
  '結果 種目 記録 … レース結果を記録（例：結果 100m 15.2秒）',
  '記録 … お子さんの記録一覧',
  '写真 … 保存した写真フォルダのリンク',
  '',
  '📷 グループに送った写真は自動でアルバム（Googleドライブ）に保存されます。',
].join('\n');

/**
 * 1語目をコマンドとして解釈する。普段の会話に反応しないよう、
 * 1語目がコマンド名と完全に一致したときだけ反応する。
 * @return {{name: string, args: string}|null}
 */
function parseCommand_(text) {
  const m = String(text).trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const word = toHalfWidth_(m[1]).toLowerCase();
  const aliases = {
    'ヘルプ': 'help', '使い方': 'help', 'help': 'help',
    '登録': 'register',
    '予定': 'events',
    '出欠': 'tally',
    '結果': 'result',
    '記録': 'records',
    '写真': 'photos', 'アルバム': 'photos',
  };
  const name = aliases[word];
  if (!name) return null;
  return { name: name, args: (m[2] || '').trim() };
}

function handleText_(ev) {
  const cmd = parseCommand_(ev.message.text);
  if (!cmd) return;
  switch (cmd.name) {
    case 'help':
      return reply_(ev.replyToken, [text_(HELP_TEXT)]);
    case 'register':
      return handleRegister_(ev, cmd.args);
    case 'events':
      return handleEventsCommand_(ev);
    case 'tally':
      return handleTallyCommand_(ev);
    case 'result':
      return handleResultCommand_(ev, cmd.args);
    case 'records':
      return handleRecordsCommand_(ev, cmd.args);
    case 'photos':
      return reply_(ev.replyToken, [text_('📷 写真フォルダ\n' + photoFolderUrl_())]);
  }
}

function handleRegister_(ev, args) {
  const userId = ev.source.userId;
  const names = splitNames_(args);
  if (!names.length) {
    const children = childrenOf_(findFamily_(userId));
    return reply_(ev.replyToken, [
      text_(
        children.length
          ? '登録中のお子さん：' + children.join('、') + '\n変更するときは「登録 名前」を送り直してください。'
          : '「登録 山田たろう」のようにお子さんの名前を送ってください。'
      ),
    ]);
  }
  saveFamily_(userId, getDisplayName_(ev.source), names);
  reply_(ev.replyToken, [text_('登録しました：' + names.join('、'))]);
}

function handleEventsCommand_(ev) {
  const events = upcomingEvents_(CONFIG.SYNC_DAYS_AHEAD);
  if (!events.length) return reply_(ev.replyToken, [text_('これからの予定はまだ登録されていません。')]);
  reply_(ev.replyToken, [eventsCarousel_(events, 'これからの予定')]);
}

function handleTallyCommand_(ev) {
  const events = upcomingEvents_(CONFIG.ANNOUNCE_DAYS_AHEAD);
  if (!events.length) return reply_(ev.replyToken, [text_(CONFIG.ANNOUNCE_DAYS_AHEAD + '日以内の予定はありません。')]);
  const children = allChildren_();
  const attendance = readRows_(SHEETS.ATTENDANCE);
  reply_(
    ev.replyToken,
    events.slice(0, 5).map((e) => text_(buildTallyText_(e, attendance.filter((a) => a.eventKey === e.eventKey), children)))
  );
}
