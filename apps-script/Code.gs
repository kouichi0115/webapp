/**
 * はい/いいえ アンケート（Google Apps Script 版）
 *  回答画面: ウェブアプリのURL
 *  集計画面: ウェブアプリのURL の末尾に ?page=admin
 */

// ★ 集計画面のボタン（質問の変更・リセット・受付終了）用のパスワード。好きな文字に変更してください
const ADMIN_PASSWORD = 'sensei';

const props = PropertiesService.getScriptProperties();

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('index');
  t.page = e && e.parameter && e.parameter.page === 'admin' ? 'admin' : 'vote';
  return t.evaluate()
    .setTitle(t.page === 'admin' ? 'アンケート集計' : 'アンケート回答')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 回答者の識別: 学校のGoogleアカウントならメール、取れなければ端末ID
function voterKey_(deviceId) {
  const email = Session.getActiveUser().getEmail();
  const raw = email || String(deviceId || '');
  if (!raw || raw.length > 200) throw new Error('端末IDが不正です');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return 'v_' + Utilities.base64EncodeWebSafe(digest);
}


function summary_(all) {
  all = all || props.getProperties();
  let yes = 0, no = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('v_') !== 0) return;
    if (all[k] === 'yes') yes++;
    else if (all[k] === 'no') no++;
  });
  const total = yes + no;
  const pct = function (n) { return total ? Math.round((n / total) * 1000) / 10 : 0; };
  return {
    question: all.question || 'この内容に賛成ですか？',
    open: all.open !== 'false',
    round: all.round || '0',
    yes: yes, no: no, total: total,
    yesRate: pct(yes), noRate: pct(no),
  };
}

function getState(deviceId) {
  const all = props.getProperties();
  const s = summary_(all);
  s.myVote = all[voterKey_(deviceId)] || null;
  return s;
}

function vote(deviceId, answer) {
  if (answer !== 'yes' && answer !== 'no') throw new Error('回答が不正です');
  if (props.getProperty('open') === 'false') throw new Error('回答の受付は終了しています');
  props.setProperty(voterKey_(deviceId), answer); // 1人1票（選び直しは上書き）
  return getState(deviceId);
}

function getSummary() {
  return summary_();
}

function admin(action, question, password) {
  if (String(password) !== String(ADMIN_PASSWORD)) throw new Error('パスワードが違います');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (action === 'reset' || action === 'question') {
      if (action === 'question') {
        question = String(question || '').trim().slice(0, 200);
        if (!question) throw new Error('質問を入力してください');
        props.setProperty('question', question);
        props.setProperty('open', 'true');
      }
      const all = props.getProperties();
      Object.keys(all).forEach(function (k) { if (k.indexOf('v_') === 0) props.deleteProperty(k); });
      props.setProperty('round', String(Date.now()));
    } else if (action === 'open') props.setProperty('open', 'true');
    else if (action === 'close') props.setProperty('open', 'false');
    else throw new Error('不正な操作です');
  } finally {
    lock.releaseLock();
  }
  return getSummary();
}
