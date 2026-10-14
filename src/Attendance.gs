/** 出欠の集計 */
function countAttendance_(rows) {
  const counts = { yes: 0, no: 0, maybe: 0 };
  rows.forEach((a) => {
    Object.keys(STATUS).forEach((k) => {
      if (a['回答'] === STATUS[k]) counts[k]++;
    });
  });
  return counts;
}

/** 出欠一覧のテキスト。allChildren を渡すと未回答者も出す */
function buildTallyText_(ev, rows, allChildren) {
  const lines = ['📋 ' + formatWhen_(ev) + ' ' + ev['タイトル']];
  const answered = [];
  Object.keys(STATUS).forEach((k) => {
    const names = rows.filter((a) => a['回答'] === STATUS[k]).map((a) => a['子ども']);
    answered.push.apply(answered, names);
    lines.push(STATUS[k] + '(' + names.length + '): ' + (names.join('、') || '-'));
  });
  if (allChildren) {
    const missing = allChildren.filter((c) => answered.indexOf(c) < 0);
    lines.push('未回答(' + missing.length + '): ' + (missing.join('、') || '-'));
  }
  return lines.join('\n');
}

/** 出欠ボタン付きのカード（Flex Message の bubble） */
function eventBubble_(ev, counts) {
  const body = [
    { type: 'text', text: ev['タイトル'] || '(無題)', weight: 'bold', size: 'md', wrap: true },
    { type: 'text', text: '🗓 ' + formatWhen_(ev), size: 'sm', color: '#555555', wrap: true },
  ];
  if (ev['場所']) body.push({ type: 'text', text: '📍 ' + ev['場所'], size: 'sm', color: '#555555', wrap: true });
  if (counts) {
    body.push({
      type: 'text',
      text: '出席 ' + counts.yes + ' / 欠席 ' + counts.no + ' / 未定 ' + counts.maybe,
      size: 'xs',
      color: '#999999',
      margin: 'md',
    });
  }
  return {
    type: 'bubble',
    size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: Object.keys(STATUS).map((s) => ({
        type: 'button',
        style: s === 'yes' ? 'primary' : 'secondary',
        height: 'sm',
        action: { type: 'postback', label: STATUS[s], data: buildQuery_({ a: 'att', e: ev.eventKey, s: s }) },
      })),
    },
  };
}

/** 予定の一覧を出欠ボタン付きカルーセルにする（最大12件） */
function eventsCarousel_(events, altText) {
  const attendance = readRows_(SHEETS.ATTENDANCE);
  const bubbles = events.slice(0, 12).map((ev) =>
    eventBubble_(ev, countAttendance_(attendance.filter((a) => a.eventKey === ev.eventKey)))
  );
  return { type: 'flex', altText: altText, contents: { type: 'carousel', contents: bubbles } };
}

/** 出欠ボタンが押されたとき */
function handleAttendancePostback_(ev, params) {
  const event = findEvent_(params.e);
  if (!event) return reply_(ev.replyToken, [text_('この予定は見つかりませんでした。')]);
  if (event['状態'] === '中止') return reply_(ev.replyToken, [text_('この予定は中止になっています。')]);
  if (!STATUS[params.s]) return;

  const userId = ev.source.userId;
  const family = findFamily_(userId);
  const children = childrenOf_(family);
  if (!children.length) {
    return reply_(ev.replyToken, [
      text_('お子さんの名前が未登録です。\n「登録 山田たろう」のように送ってから、もう一度ボタンを押してください。'),
    ]);
  }

  let targets;
  if (params.c === '*') {
    targets = children;
  } else if (params.c) {
    if (children.indexOf(params.c) < 0) return;
    targets = [params.c];
  } else if (children.length === 1) {
    targets = children;
  } else {
    // きょうだいがいる場合は誰の回答か選んでもらう
    const items = children.concat(['*']).slice(0, 13).map((c) => ({
      type: 'action',
      action: {
        type: 'postback',
        label: ((c === '*' ? '全員' : c) + ':' + STATUS[params.s]).slice(0, 20),
        data: buildQuery_({ a: 'att', e: event.eventKey, s: params.s, c: c }),
      },
    }));
    return reply_(ev.replyToken, [
      Object.assign(text_('どなたの回答ですか？（' + event['タイトル'] + '）'), { quickReply: { items: items } }),
    ]);
  }

  const displayName = family['表示名'] || getDisplayName_(ev.source);
  targets.forEach((child) => saveAttendance_(event, child, params.s, userId, displayName));

  if (CONFIG.CONFIRM_ATTENDANCE) {
    reply_(ev.replyToken, [
      text_('✅ ' + targets.join('、') + '：' + STATUS[params.s] + '（' + formatDate_(event['日付']) + ' ' + event['タイトル'] + '）'),
    ]);
  }
}
