// ─────────────────────────────────────
//  import-notion.js  Notionからの一括インポート
// ─────────────────────────────────────
import { DB }    from './db.js';
import { Sound } from './sound.js';
import { showToast } from './utils.js';

const NOTION_DB_ID  = '1dd85cf70c4c8055949bf3ad4ecf7ef0';
const PROXY_URL     = 'https://copyzpsyagscqrvkrwjo.supabase.co/functions/v1/notion-proxy';

// ── Notionアカウント名 → Flowra口座名 マッピング ──────────
// 右辺がFlowraの口座名（部分一致で解決）
const ACCOUNT_NAME_MAP = {
  'みずほ池袋':           'みずほ銀行 池袋支店',
  '預金_みずほ池袋':      'みずほ銀行 池袋支店',
  '預金_みずほ池袋積立':  'みずほ銀行 池袋支店',
  'みずほ銀行':           'みずほ銀行 池袋支店',
  '預金_みずほネット':    'みずほ銀行 池袋支店',
  'みずほ朝霞':           'みずほ銀行 朝霞支店',
  'みずほ高円寺北口':     'みずほ銀行 高円寺北口支店',
  'JAあさかの':           'JAあさか野',
  '楽天カード':           '楽天カード',
  '家族楽天カード':       '楽天カード',
  'Amazonカード':         'Amazonカード',
  'マニュライフ積立':     'マニュライフ生命',
  '朝日生命年金':         '朝日生命年金',
  '粧子_朝日生命積立':    '朝日生命年金',
  // Suica系
  'Suica':                'Suica',
  '通勤定期券':           'Suica',
  '電子_Suica通常':       'Suica',
  '電子_Suica定期券':     'Suica',
  '電子_Suicaみずほ':     'Suica',
  '電子_Suica_Android':   'Suica',
  '電子_Suica粧子':       'Suica',
  '電子_Suica梗華':       'Suica',
  '資産_通勤定期':        'Suica',
  '電子_PASMO':           'Suica',
  '粧子_PASMO':           'Suica',
  // PayPay系
  'PayPay':               'PayPay',
  '粧子PayPay':           'PayPay',
  '梗華PayPay':           'PayPay',
  'PayPayカード':         'PayPay',
  'カード_PayPay':        'PayPay',
  '電子_PayPay2_Android': 'PayPay',
  // メルペイ系
  'メルペイ':             'メルペイ',
  'カード_メルペイスマート': 'メルペイ',
  // 現金系（その他すべて → 現金）
  '現金':     '現金',
  '封筒現金': '現金',
  '自宅現金': '現金',
  '粧子_現金': '現金',
};

// ── Notion API ────────────────────────────────────────────

async function notionQuery(token, cursor = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000); // 30秒でタイムアウト

  try {
    const res = await fetch(PROXY_URL, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-notion-token': token,
      },
      body:   JSON.stringify({ cursor }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.message || `proxy error ${res.status}`);
    }
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`タイムアウト（cursor: ${cursor ? cursor.slice(0,8) : 'null'}）`);
    }
    throw e;
  }
}

// ── 軽量スキャン ──────────────────────────────────────────
// 全レコードを1パスで走査し、「変換済み最小レコード」だけを蓄積する。
//
// 【旧実装の問題】
//   fetchAllNotionRecords でフルの Notion ページ JSON（1件あたり数KB）を
//   全件メモリに保持 → 3万件で数十〜150MB → モバイルでクラッシュ
//
// 【新実装の方針】
//   Notion ページは取得後すぐに変換して最小レコード（~100B/件）に変換し
//   フル JSON は捨てる。3万件で 3MB 程度になりモバイルでも安全。
//
// 返り値:
//   collected      : [{id, type, amount, date, account_id, memo, tagName}]
//   tagNames       : ユニークなタグ名の配列（syncTags 用）
//   unknownAccounts: マッピング未定義の口座名の配列（プレビュー表示用）
async function scanAndCollect(token, flowraAccounts, onProgress) {
  const collected = [];
  const tagNamesSet      = new Set();
  const unknownAccounts  = new Set();
  let cursor  = null;
  let hasMore = true;

  while (hasMore) {
    const resp = await notionQuery(token, cursor);
    hasMore = resp.has_more;
    cursor  = resp.next_cursor;

    for (const page of resp.results) {
      const props  = page.properties;
      const 管理   = props['管理']?.select?.name;
      const 分類   = props['分類']?.select?.name;

      // 除外フィルタ
      if (管理 === '除外' || 分類 === '除外') continue;

      const 日付   = props['日付']?.date?.start;
      const 金額   = props['金額']?.number;
      if (!日付 || 金額 == null) continue;

      // タグ名収集（フル JSON の代わりに文字列だけ保持）
      if (分類) tagNamesSet.add(分類);

      // 口座解決
      const acctLabel = props['アカウント']?.select?.name || '';
      const { id: account_id, original } = resolveAccountId(acctLabel, flowraAccounts);
      if (acctLabel && !ACCOUNT_NAME_MAP[acctLabel]) unknownAccounts.add(acctLabel);

      // メモ組み立て
      const 内容   = getText(props['内容']);
      const 支払先 = getText(props['支払先']);
      const メモ   = getText(props['メモ']);
      const memoParts = [内容, 支払先, メモ].map(s => s.trim()).filter(Boolean);
      if (original) memoParts.push(`(元口座: ${original})`);

      // 最小レコードのみ保持（Notion ページ JSON は捨てる）
      collected.push({
        id:         crypto.randomUUID(),
        type:       金額 > 0 ? 'income' : 'expense',
        amount:     Math.abs(金額),
        date:       日付,
        account_id,
        memo:       memoParts.join(' ').trim() || null,
        tagName:    分類 || null,   // タグ ID は syncTags 後に付与
      });
    }

    if (onProgress) onProgress(collected.length);
  }

  return {
    collected,
    tagNames:        [...tagNamesSet],
    unknownAccounts: [...unknownAccounts],
  };
}

// ── レコード変換 ───────────────────────────────────────────

function getText(prop) {
  if (!prop) return '';
  if (prop.type === 'title')     return prop.title?.map(t => t.plain_text).join('') || '';
  if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || '';
  return '';
}

function resolveAccountId(notionName, flowraAccounts) {
  const targetName = ACCOUNT_NAME_MAP[notionName];
  if (targetName) {
    const acc = flowraAccounts.find(a => a.name === targetName)
             || flowraAccounts.find(a => a.name.includes(targetName) || targetName.includes(a.name));
    if (acc) return { id: acc.id, original: null };
  }
  // フォールバック：現金口座 + 元口座名をmemoに記録
  const cash = flowraAccounts.find(a => a.type === 'cash' || a.name === '現金');
  return { id: cash?.id || flowraAccounts[0]?.id, original: notionName };
}


// ── タグの同期（なければ作成）─────────────────────────────

async function syncTags(tagNames, existingTags) {
  const map = {};
  const toCreate = [];

  for (const name of tagNames) {
    const found = existingTags.find(t => t.name === name);
    if (found) {
      map[name] = found.id;
    } else {
      toCreate.push(name);
    }
  }

  for (const name of toCreate) {
    try {
      const tag = await DB.createTag(name);
      map[name] = tag.id;
    } catch (e) {
      console.warn('タグ作成エラー:', name, e.message);
    }
  }

  return map;
}

// ── UI ────────────────────────────────────────────────────

export async function showImportNotion() {
  Sound.playOpen();

  const overlay = document.createElement('div');
  overlay.id = 'import-notion-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:800;
    background:var(--stone);
    display:flex;flex-direction:column;
    overflow-y:auto;
  `;
  document.body.appendChild(overlay);

  function setContent(html) {
    overlay.innerHTML = `
      <div style="max-width:480px;width:100%;margin:0 auto;padding:env(safe-area-inset-top,20px) 20px 40px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:28px;padding-top:16px;">
          <button id="btn-import-back"
            style="width:32px;height:32px;border-radius:50%;background:var(--mist);border:none;
            display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--mid)" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div style="font-family:'Noto Serif JP',serif;font-size:17px;font-weight:600;">Notionからインポート</div>
        </div>
        ${html}
      </div>`;
    document.getElementById('btn-import-back')?.addEventListener('click', () => {
      Sound.playClose();
      overlay.remove();
    });
  }

  // ── Step 1: トークン入力 ──
  function showStep1() {
    setContent(`
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head"><div class="panel-title">Notion インテグレーショントークン</div></div>
        <div style="padding:16px 18px;">
          <p style="font-size:13px;color:var(--mid);line-height:1.7;margin-bottom:16px;">
            1. <a href="https://www.notion.so/my-integrations" target="_blank" style="color:var(--sage);">notion.so/my-integrations</a> を開く<br>
            2. 「新しいインテグレーション」を作成<br>
            3. 収支一覧データベースをインテグレーションと共有<br>
            4. 発行されたトークン（secret_...）を貼り付け
          </p>
          <div class="form-section">
            <div class="form-row no-tap">
              <div class="row-body">
                <div class="row-label">インテグレーショントークン</div>
                <input class="text-input" id="notion-token-input"
                  placeholder="secret_xxxxxxxxxxxxxxxx"
                  style="font-size:13px;font-family:monospace;">
              </div>
            </div>
          </div>
          <div id="token-error" style="display:none;font-size:11.5px;color:var(--red);margin-top:8px;"></div>
        </div>
      </div>
      <button class="btn-primary" id="btn-validate-token">
        <svg viewBox="0 0 24 24" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>
        接続して件数を確認
      </button>
    `);

    document.getElementById('btn-import-back')?.addEventListener('click', () => {
      Sound.playClose(); overlay.remove();
    });

    document.getElementById('btn-validate-token')?.addEventListener('click', async () => {
      const token    = document.getElementById('notion-token-input')?.value.trim();
      const errorEl  = document.getElementById('token-error');
      const btn      = document.getElementById('btn-validate-token');

      if (!token || (!token.startsWith('secret_') && !token.startsWith('ntn_'))) {
        errorEl.textContent = 'トークンは secret_ または ntn_ から始まります';
        errorEl.style.display = 'block';
        return;
      }

      btn.disabled    = true;
      btn.textContent = '接続中…';
      errorEl.style.display = 'none';

      try {
        // 1件だけフェッチしてトークンを検証
        await notionQuery(token);
        showStep2(token);
      } catch (e) {
        errorEl.textContent = `接続エラー: ${e.message}`;
        errorEl.style.display = 'block';
        btn.disabled    = false;
        btn.innerHTML   = '<svg viewBox="0 0 24 24" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg> 接続して件数を確認';
      }
    });
  }

  // ── Step 2: データ取得中（軽量スキャン）──
  // Notion から全件を1パスで走査し、変換済み最小レコードを蓄積する。
  // フルの Notion ページ JSON は保持しないのでメモリは O(件数 × ~100B) に収まる。
  async function showStep2(token) {
    // Flowra 口座を事前取得（口座解決に必要）
    let flowraAccounts;
    try {
      flowraAccounts = await DB.getAccounts();
    } catch (e) {
      showError(`口座の取得に失敗しました: ${e.message}`, showStep1);
      return;
    }

    setContent(`
      <div style="text-align:center;padding:40px 20px;">
        <div class="spinner" style="margin:0 auto 20px;"></div>
        <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;margin-bottom:8px;">Notionからデータを取得中</div>
        <div id="fetch-count" style="font-size:13px;color:var(--mid);">0 件スキャン済み…</div>
        <div style="font-size:11px;color:var(--mid-lt);margin-top:8px;">件数が多い場合は数分かかります</div>
      </div>
    `);

    try {
      const result = await scanAndCollect(token, flowraAccounts, count => {
        const el = document.getElementById('fetch-count');
        if (el) el.textContent = `${count.toLocaleString()} 件スキャン済み…`;
      });
      showStep3(token, flowraAccounts, result);
    } catch (e) {
      showError(`取得エラー: ${e.message}`, showStep1);
    }
  }

  // ── Step 3: プレビュー ──
  async function showStep3(token, flowraAccounts, { collected, tagNames, unknownAccounts }) {
    const existingTags = await DB.getTags();

    // 既存データ件数（重複警告用）
    const existingCount = await DB.getTransactions({ page: 0, pageSize: 1 })
      .then(r => r.count).catch(() => 0);

    const newTagCount = tagNames.filter(n => !existingTags.find(t => t.name === n)).length;

    const warnHtml = existingCount > 0
      ? `<div style="background:var(--gold-bg);border:1px solid var(--gold);border-radius:12px;
           padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--ink);line-height:1.6;">
           ⚠️ 既に <strong>${existingCount.toLocaleString()} 件</strong>のデータがあります。<br>
           重複インポートに注意してください。
         </div>`
      : '';

    const unknownHtml = unknownAccounts.length > 0
      ? `<div style="font-size:12px;color:var(--mid);margin-top:8px;line-height:1.7;">
           現金口座に割り当てる口座（${unknownAccounts.length}種）:<br>
           <span style="font-size:11px;">${unknownAccounts.slice(0,10).join('、')}${unknownAccounts.length > 10 ? ` … 他${unknownAccounts.length - 10}種` : ''}</span>
         </div>`
      : '';

    setContent(`
      ${warnHtml}
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-head"><div class="panel-title">インポート内容</div></div>
        <div style="padding:4px 0;">
          <div class="form-row no-tap">
            <span style="font-size:14px;">取得件数</span>
            <span style="font-weight:600;font-size:15px;">${collected.length.toLocaleString()} 件</span>
          </div>
          <div class="form-row no-tap">
            <span style="font-size:14px;">新規タグ</span>
            <span style="color:var(--sage);font-weight:500;">${newTagCount} 種類を新規作成</span>
          </div>
          <div class="form-row no-tap" style="border-bottom:none;flex-direction:column;align-items:flex-start;gap:4px;">
            <span style="font-size:14px;">口座マッピング</span>
            ${unknownHtml || '<span style="font-size:12px;color:var(--mid);">すべて自動マッピング済み</span>'}
          </div>
        </div>
      </div>
      <button class="btn-primary" id="btn-start-import" style="margin-bottom:10px;">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
        </svg>
        ${collected.length.toLocaleString()} 件をインポート
      </button>
      <button id="btn-cancel-import"
        style="width:100%;padding:12px;background:none;border:none;color:var(--mid);font-size:13px;cursor:pointer;">
        キャンセル
      </button>
    `);

    document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
      Sound.playClose(); overlay.remove();
    });

    document.getElementById('btn-start-import')?.addEventListener('click', () => {
      showStep4(collected, existingTags);
    });
  }

  // ── Step 4: インポート実行 ──
  // collected: [{id, type, amount, date, account_id, memo, tagName}]
  // tagName は仮置き。syncTags でIDに変換してから挿入する。
  async function showStep4(collected, existingTags) {
    setContent(`
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-family:'Noto Serif JP',serif;font-size:15px;font-weight:600;margin-bottom:20px;">インポート中…</div>
        <div style="background:var(--border);border-radius:999px;height:8px;margin-bottom:12px;overflow:hidden;">
          <div id="import-progress-bar" style="height:100%;background:var(--sage);border-radius:999px;width:0%;transition:width 0.3s ease;"></div>
        </div>
        <div id="import-status" style="font-size:13px;color:var(--mid);">準備中…</div>
      </div>
    `);

    const setStatus = (text, pct) => {
      const bar = document.getElementById('import-progress-bar');
      const st  = document.getElementById('import-status');
      if (bar) bar.style.width = `${pct}%`;
      if (st)  st.textContent  = text;
    };

    try {
      // Step 4-1: タグ同期（collected から tagName を収集してまとめて作成）
      setStatus('タグを同期中…', 5);
      const tagNamesSet = new Set(collected.map(r => r.tagName).filter(Boolean));
      const tagNameToId = await syncTags([...tagNamesSet], existingTags);

      // Step 4-2: tagName → tagId に変換してレコードを分離
      setStatus('データを変換中…', 12);
      const txRows  = [];
      const tagRows = [];
      for (const { tagName, ...txData } of collected) {
        txRows.push(txData);
        const tagId = tagName ? (tagNameToId[tagName] || null) : null;
        if (tagId) tagRows.push({ transaction_id: txData.id, tag_id: tagId });
      }

      // Step 4-3: トランザクション挿入（200件/バッチ）
      setStatus(`記録を挿入中… (0 / ${txRows.length.toLocaleString()})`, 20);
      await DB.importTransactions(txRows, (done, total) => {
        const pct = 20 + Math.round((done / total) * 60);
        setStatus(`記録を挿入中… (${done.toLocaleString()} / ${total.toLocaleString()})`, pct);
      });

      // Step 4-4: タグ紐付け挿入（500件/バッチ）
      setStatus(`タグを関連付け中… (0 / ${tagRows.length.toLocaleString()})`, 80);
      await DB.bulkInsertTransactionTags(tagRows, (done, total) => {
        const pct = 80 + Math.round((done / total) * 18);
        setStatus(`タグを関連付け中… (${done.toLocaleString()} / ${total.toLocaleString()})`, pct);
      });

      setStatus('完了！', 100);
      setTimeout(() => showStep5(txRows.length, tagRows.length), 500);

    } catch (e) {
      showError(`インポートエラー: ${e.message}`, () => overlay.remove());
    }
  }

  // ── エラー表示（共通） ──
  function showError(message, onClose) {
    setContent(`
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:15px;color:var(--red);margin-bottom:12px;">エラー</div>
        <div style="font-size:13px;color:var(--mid);margin-bottom:20px;">${message}</div>
        <button class="btn-primary" id="btn-err-close">戻る</button>
      </div>
    `);
    document.getElementById('btn-err-close')?.addEventListener('click', () => {
      Sound.playClose();
      onClose();
    });
  }

  // ── Step 5: 完了 ──
  function showStep5(txCount, tagCount) {
    Sound.playSave();
    setContent(`
      <div style="text-align:center;padding:48px 20px;">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--sage-bg);
          display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--sage)" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div style="font-family:'Noto Serif JP',serif;font-size:18px;font-weight:600;margin-bottom:10px;">
          インポート完了
        </div>
        <div style="font-size:14px;color:var(--mid);line-height:1.8;margin-bottom:32px;">
          ${txCount.toLocaleString()} 件の記録をインポートしました<br>
          タグ紐付け: ${tagCount.toLocaleString()} 件
        </div>
        <button class="btn-primary" id="btn-import-done">記録を確認する</button>
      </div>
    `);

    document.getElementById('btn-import-done')?.addEventListener('click', () => {
      overlay.remove();
      // 記録一覧へ遷移
      const Router = window._flowraRouter;
      if (Router) Router.navigate('records');
    });
  }

  // エントリポイント
  showStep1();
}
