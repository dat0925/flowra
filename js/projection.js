// ══════════════════════════════════════════════
//  projection.js  「現在残高」と「月末予定」の導出（共通）
//
//  背景:
//   accounts.balance はDBトリガーで全取引（未来日付ぶんも含む）が
//   即時加算された running total になっている。
//   そのため「今この口座にいくらあるか」を出すには、未来分を差し引く
//   必要がある。ここではその導出だけを担い、DB側は一切変更しない。
//
//   現在残高   = balance −（date > 今日(JST) の符号付き合計）
//   月末予定   = balance −（date > 今月末(JST) の符号付き合計）
//             = 現在残高 +（今日〜月末の未来分）
//
//  符号: 収入=+/支出=−/振替=出元−・移動先+（1取引で両足）。
//  振替は両足が相殺されるため、総額では収入・支出だけが効く。
// ══════════════════════════════════════════════

import { DB } from './db.js';

const pad = (n) => String(n).padStart(2, '0');

// JSTの年月日パーツ（端末TZに依存せず Asia/Tokyo 固定で算出）
function jstParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((x) => x.type === t).value;
  return { y: +get('year'), m: +get('month'), d: +get('day') };
}

export function jstTodayStr(d = new Date()) {
  const { y, m, d: day } = jstParts(d);
  return `${y}-${pad(m)}-${pad(day)}`;
}

export function jstMonthEndStr(d = new Date()) {
  const { y, m } = jstParts(d);
  // m は1始まり。Date.UTC(y, m, 0) はその月の最終日になる。
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(last)}`;
}

// 1取引を「口座ID → 符号付き金額」の脚（leg）に分解する
function legsOf(tx) {
  const amt = Number(tx.amount) || 0;
  if (tx.type === 'income')   return [{ id: tx.account_id, delta:  amt }];
  if (tx.type === 'expense')  return [{ id: tx.account_id, delta: -amt }];
  if (tx.type === 'transfer') return [
    { id: tx.account_id,    delta: -amt },
    { id: tx.to_account_id, delta:  amt },
  ];
  return [];
}

// 指定口座の「未来分（date > 今日）の符号付き合計」。手動残高調整の足し戻し用。
export function futureSumForAccount(futureTxns, acctId, today = jstTodayStr()) {
  let sum = 0;
  for (const tx of (futureTxns || [])) {
    if (!(tx.date > today)) continue;
    for (const leg of legsOf(tx)) {
      if (leg.id === acctId) sum += leg.delta;
    }
  }
  return sum;
}

// accounts と未来取引から、口座ごと/総額の現在残高・月末予定を計算
export function computeProjections(accounts, futureTxns, opts = {}) {
  const today    = opts.today    || jstTodayStr();
  const monthEnd = opts.monthEnd || jstMonthEndStr();

  const beyondToday = new Map(); // acctId → Σ符号付き(date > 今日)
  const beyondMonth = new Map(); // acctId → Σ符号付き(date > 月末)

  for (const tx of (futureTxns || [])) {
    const afterToday = tx.date > today;
    const afterMonth = tx.date > monthEnd;
    if (!afterToday && !afterMonth) continue;
    for (const { id, delta } of legsOf(tx)) {
      if (!id) continue;
      if (afterToday) beyondToday.set(id, (beyondToday.get(id) || 0) + delta);
      if (afterMonth) beyondMonth.set(id, (beyondMonth.get(id) || 0) + delta);
    }
  }

  const byId = new Map();
  let totalCurrent = 0;
  let totalProjected = 0;

  for (const a of accounts) {
    const bt = beyondToday.get(a.id) || 0;
    const bm = beyondMonth.get(a.id) || 0;
    const current   = a.balance - bt;
    const projected = a.balance - bm;
    byId.set(a.id, { current, projected, hasFuture: current !== projected });
    totalCurrent   += current;
    totalProjected += projected;
  }

  return {
    byId,
    totalCurrent,
    totalProjected,
    totalHasFuture: totalCurrent !== totalProjected,
  };
}

// accounts を渡すと未来取引を取得して projection を返す（取得失敗時は null）
export async function loadProjections(accounts) {
  const today    = jstTodayStr();
  const monthEnd = jstMonthEndStr();
  let futureTxns = [];
  try {
    futureTxns = await DB.getTransactionsAfter(today);
  } catch {
    return null;
  }
  const proj = computeProjections(accounts, futureTxns, { today, monthEnd });
  proj.futureTxns = futureTxns; // 呼び出し側が口座別の足し戻しに使えるよう同梱
  proj.today = today;
  return proj;
}
