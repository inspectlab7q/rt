/**
 * 設定値。クラブの運用に合わせてここを書き換えてください。
 *
 * 秘密の値（アクセストークンなど）はコードに書かず、
 * 「プロジェクトの設定 > スクリプト プロパティ」に保存します。
 *   LINE_CHANNEL_ACCESS_TOKEN … LINE Developers で発行したチャネルアクセストークン（必須）
 *   CALENDAR_ID               … 練習・大会を登録する Google カレンダーの ID（必須）
 *   SPREADSHEET_ID            … setup() が自動で作成・保存します
 *   PHOTO_FOLDER_ID           … setup() が自動で作成・保存します
 *   WEBHOOK_TOKEN             … setup() が自動で作成・保存します
 *   GROUP_ID                  … Bot をグループに招待すると自動で保存されます
 */
const CONFIG = {
  TIMEZONE: 'Asia/Tokyo',

  // カレンダーから何日先までの予定を取り込むか
  SYNC_DAYS_AHEAD: 30,
  // 何日前になったらグループに出欠ボタン付きの案内を流すか
  ANNOUNCE_DAYS_AHEAD: 7,
  // 何日前に「未回答の人」のリマインドを流すか（0 にするとリマインドしない）
  REMIND_DAYS_BEFORE: 2,
  // 毎日の自動処理（カレンダー同期・案内・リマインド）を何時に動かすか
  DAILY_HOUR: 7,

  // グループに投稿された写真をすべてドライブに保存するか
  SAVE_ALL_PHOTOS: true,
  // 写真を何日前までの予定に紐づけるか（大会の翌日に写真を上げる場合など）
  PHOTO_EVENT_LOOKBACK_DAYS: 2,
  // 結果を何日前までの予定に紐づけるか
  RESULT_EVENT_LOOKBACK_DAYS: 7,

  // 出欠ボタンを押したとき、グループに「受け付けました」と返信するか
  CONFIRM_ATTENDANCE: true,
};

const STATUS = {
  yes: '出席',
  no: '欠席',
  maybe: '未定',
};

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function requireProp_(key) {
  const value = prop_(key);
  if (!value) throw new Error('スクリプト プロパティ ' + key + ' が設定されていません');
  return value;
}
