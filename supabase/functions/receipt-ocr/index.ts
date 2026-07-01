import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SB_ANON_KEY       = Deno.env.get('SB_ANON_KEY')!;
const SB_SVC_KEY        = Deno.env.get('SB_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const GOOGLE_API_KEY    = Deno.env.get('GOOGLE_API_KEY') || '';
const OPENAI_API_KEY    = Deno.env.get('OPENAI_API_KEY') || '';

const FREE_RECEIPT_LIMIT    = 10;
const PREMIUM_RECEIPT_LIMIT = 200;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function buildPromptText(tagListText: string): string {
  return `このレシートから品目と金額を抽出してください。
以下のJSON形式のみで回答してください（説明文不要）：
{
  "store": "店名（不明なら空文字）",
  "date": "YYYY-MM-DD形式の日付（不明なら空文字）",
  "total": レシートに印字されている合計金額（税込・支払総額。「合計」「お会計」等の行の数値。不明なら0）,
  "items": [
    { "name": "品目名", "amount": 金額の数値（税込・値引き後）, "taxRate": 8または10, "tag": "メインカテゴリ名または空文字", "subTags": ["サブカテゴリ名"] }
  ]
}

【最重要・絶対厳守】実在しない品目を絶対に作らないこと：
- 出力する品目は、画像内に実際に印字されている「品目名の行」に1対1で対応するものだけにすること
- 文字が不鮮明・かすれ・判読不能な行は、内容を推測して埋めるのではなく、その行ごとスキップすること
- 「一般的なスーパーの買い物ならありそうな商品」を文脈から推測して補完することは絶対に禁止（例：キャベツが読み取れたからといって肉・魚・調味料などを憶測で追加しない）
- 「2コ X 単105」「3コ X 単169」のような行は、直前の品目の数量・単価の内訳を示す注記であり、独立した品目ではない。この注記行の単価や数量を新しい品目名・金額として抽出してはならない
- 迷ったら「出力しない」を選ぶこと。品目数が実際より少なくなる方が、存在しない品目を混入させるより遥かに良い
- 「合計金額の辻褄を合わせるために品目名や金額を調整する」ことも絶対禁止。totalとitemsはそれぞれ画像から独立に、見えたものだけを別々に転記すること（一致させようと逆算・創作しない）

ルール：
- 小計・合計・消費税・お釣りの行はitems配列に含めない（合計はtotalフィールドへ）
- ポイント値引き・割引行はamountをマイナス数値で含める（例: { "name": "ポイント値引き", "amount": -50, "taxRate": 10, "tag": "", "subTags": [] }）
- 金額は数値のみ（¥や円は含めない）
- 読み取れない品目はスキップ
- 品目名は略さずレシートに印字された名前をそのまま使う
- taxRateは日本の消費税法に基づき判定する：
  ・飲食料品（食材・調味料・飲み物・お菓子・アイスなど）→ 8
  ・酒類・外食・日用品・衣類・医薬品・化粧品など → 10
  ・判断に迷う場合はレシートの税区分記号（※や★など）を参考にする

【タグ分類の重要ルール】
メインカテゴリは品目の性質を正確に判断して選ぶこと：
- お菓子・スナック・アイス・ジュース・コーヒー・酒類など「必需品ではない嗜好品」→「嗜好品」
- 食材・調味料・米・乾物・冷凍食品など「料理に使う食品」→「食費」
- シャンプー・洗剤・ティッシュ・トイレットペーパーなど「生活用品」→「日用品」
- 「食費」はデフォルトで選ばず、品目の性質をよく考えて分類すること${tagListText}

【出力前の最終確認】
JSONを出力する前に、items配列の各要素について「この品目名は画像内の対応する行に実際に印字されているか」を1件ずつ再確認し、確信が持てない品目は削除してから出力すること。totalは品目の合計と一致していなくても構わない（一致させるための操作は禁止、見たままを転記する）。`;
}

async function callAnthropic(model: string, image: string, mediaType: string, promptText: string): Promise<string> {
  const { default: Anthropic } = await import('https://esm.sh/@anthropic-ai/sdk@0.27.3?target=deno');
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: image } },
          { type: 'text', text: promptText }
        ]
      }]
    });
    return message.content[0].type === 'text' ? message.content[0].text : '';
  } catch (e: unknown) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new Error('Anthropic APIキーが無効です。キーを確認してください。');
    if (status === 429) throw new Error('Anthropic APIの利用制限に達しました。しばらく待ってから再試行してください。');
    throw e;
  }
}

async function callGoogle(model: string, image: string, mediaType: string, promptText: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mediaType, data: image } },
          { text: promptText }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      }
    })
  });
  const data = await res.json();
  if (data.error) {
    const code = data.error.code;
    if (code === 400 && data.error.status === 'INVALID_ARGUMENT') throw new Error('Google APIキーが無効です。キーを確認してください。');
    if (code === 403) throw new Error('Google APIキーに権限がありません。Generative Language APIが有効か確認してください。');
    if (code === 429) throw new Error('Google APIの利用制限に達しました。しばらく待ってから再試行してください。');
    throw new Error(`Gemini error: ${data.error.message}`);
  }
  // thinkingモードの場合、parts[0]がthought、parts[1]がテキストになる
  const parts = data.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find((p: {text?: string; thought?: boolean}) => !p.thought && p.text);
  return textPart?.text || parts[0]?.text || '';
}

async function callOpenAI(model: string, image: string, mediaType: string, promptText: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
          { type: 'text', text: promptText }
        ]
      }]
    })
  });
  const data = await res.json();
  if (data.error) {
    const type = data.error.type;
    if (type === 'invalid_request_error' && data.error.code === 'invalid_api_key') throw new Error('OpenAI APIキーが無効です。キーを確認してください。');
    if (type === 'insufficient_quota') throw new Error('OpenAI APIの残高が不足しています。チャージしてください。');
    if (res.status === 429) throw new Error('OpenAI APIの利用制限に達しました。しばらく待ってから再試行してください。');
    throw new Error(`OpenAI error: ${data.error.message}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

// トークン上限で途中切断されたJSONから、"items"配列内で完全にパースできる
// 要素だけを取り出して復元する。末尾の壊れた1件は捨てる（欠損は許容し、全滅は避ける）。
function repairTruncatedJson(text: string): { store: string; date: string; items: { name: string; amount: number; taxRate?: number; tag?: string; subTags?: string[] }[] } | null {
  const storeMatch = text.match(/"store"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const dateMatch = text.match(/"date"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const itemsStart = text.indexOf('"items"');
  if (itemsStart === -1) return null;
  const arrStart = text.indexOf('[', itemsStart);
  if (arrStart === -1) return null;

  const items: { name: string; amount: number; taxRate?: number; tag?: string; subTags?: string[] }[] = [];
  let i = arrStart + 1;
  while (i < text.length) {
    const objStart = text.indexOf('{', i);
    if (objStart === -1) break;
    // 対応する閉じ } を、文字列内の { } を無視しつつ探す
    let depth = 0, inStr = false, esc = false, objEnd = -1;
    for (let j = objStart; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { objEnd = j; break; } }
    }
    if (objEnd === -1) break; // ここで途切れている＝未完成な最後の1件、捨てて終了
    try {
      const obj = JSON.parse(text.slice(objStart, objEnd + 1));
      if (obj && typeof obj.name === 'string' && typeof obj.amount === 'number') items.push(obj);
    } catch { /* この要素は壊れているのでスキップ */ }
    i = objEnd + 1;
  }

  if (items.length === 0) return null;
  return { store: storeMatch?.[1] || '', date: dateMatch?.[1] || '', items };
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '認証が必要です' }, 401);

    const sbAnon = createClient(SUPABASE_URL, SB_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await sbAnon.auth.getUser();
    if (authError || !user) return json({ error: 'ログインが必要です' }, 401);

    const sb = createClient(SUPABASE_URL, SB_SVC_KEY);

    const { data: planRow } = await sb
      .from('user_plans')
      .select('plan, expires_at')
      .eq('user_id', user.id)
      .maybeSingle();
    const plan = planRow?.plan || 'free';
    const expired = planRow?.expires_at && new Date(planRow.expires_at) < new Date();
    const effectivePlan = expired ? 'free' : plan;
    const isPremium = effectivePlan === 'premium' || effectivePlan === 'admin';
    const limit = isPremium ? PREMIUM_RECEIPT_LIMIT : FREE_RECEIPT_LIMIT;

    const monthKey = new Date().toISOString().slice(0, 7);
    const { data: usageRow } = await sb
      .from('receipt_usage')
      .select('count')
      .eq('user_id', user.id)
      .eq('month_key', monthKey)
      .maybeSingle();
    const currentCount = usageRow?.count ?? 0;

    if (currentCount >= limit) {
      return json({ error: 'LIMIT_REACHED', limit, count: currentCount, isPremium }, 429);
    }

    const body = await req.json();
    const { image, mediaType = 'image/jpeg', teamId } = body;
    if (!image) return json({ error: '画像が必要です' }, 400);

    // ── モデル設定をDBから読み込む ──
    const { data: modelSetting } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', 'receipt_ocr_model')
      .maybeSingle();
    const modelString = modelSetting?.value || 'anthropic/claude-sonnet-4-6';
    const slashIdx = modelString.indexOf('/');
    const provider = modelString.slice(0, slashIdx);
    const modelId  = modelString.slice(slashIdx + 1);

    let allTags: { id: string; name: string }[] = [];
    let primaryTagIds = new Set<string>();

    if (teamId) {
      const [tagRes, budgetRes] = await Promise.all([
        sb.from('tags').select('id, name').eq('team_id', teamId).order('sort_order', { ascending: true }),
        sb.from('budgets').select('tag_id').eq('team_id', teamId),
      ]);
      allTags = tagRes.data || [];
      primaryTagIds = new Set((budgetRes.data || []).map((b: { tag_id: string }) => b.tag_id));
    }

    const primaryTags = primaryTagIds.size > 0
      ? allTags.filter(t => primaryTagIds.has(t.id))
      : allTags;
    const subTags = allTags.filter(t => !primaryTagIds.has(t.id));

    const primaryTagText = primaryTags.length > 0
      ? `メインカテゴリ（必ず1つ選ぶ）：\n${primaryTags.map(t => `- ${t.name}`).join('\n')}`
      : '';
    const subTagText = subTags.length > 0
      ? `サブカテゴリ（物品・食材の種類を示すものを複数選んでよい）：\n${subTags.map(t => `- ${t.name}`).join('\n')}`
      : '';
    const tagListText = (primaryTagText || subTagText)
      ? `\n\n${primaryTagText}\n\n${subTagText}\n\n【タグ選択ルール】\n- メインカテゴリは上記から1つ選びtagフィールドへ\n- サブカテゴリは物品・食材・飲料の種類を示すものを複数選びsubTagsフィールドへ（配列）\n- 「無駄遣い」「節約可能」「お気に入り」など感情・評価・行動を表すタグは絶対に選ばない\n- 当てはまるものがなければ空文字または空配列にする`
      : '';

    const tagNameToId = new Map(allTags.map(t => [t.name, t.id]));
    const promptText = buildPromptText(tagListText);

    // ── APIキーの存在確認 ──
    if (provider === 'anthropic' && !ANTHROPIC_API_KEY) {
      return json({ error: 'Anthropic APIキーが設定されていません。管理者にお問い合わせください。' }, 500);
    }
    if (provider === 'google' && !GOOGLE_API_KEY) {
      return json({ error: 'Google APIキーが設定されていません。Supabaseの環境変数にGOOGLE_API_KEYを追加してください。' }, 500);
    }
    if (provider === 'openai' && !OPENAI_API_KEY) {
      return json({ error: 'OpenAI APIキーが設定されていません。Supabaseの環境変数にOPENAI_API_KEYを追加してください。' }, 500);
    }

    // ── プロバイダーに応じてAPI呼び出し ──
    let rawText = '';
    if (provider === 'anthropic') {
      rawText = await callAnthropic(modelId, image, mediaType, promptText);
    } else if (provider === 'google') {
      rawText = await callGoogle(modelId, image, mediaType, promptText);
    } else if (provider === 'openai') {
      rawText = await callOpenAI(modelId, image, mediaType, promptText);
    } else {
      return json({ error: `未対応のプロバイダー: ${provider}` }, 400);
    }

    let parsed: { store: string; date: string; total?: number; items: { name: string; amount: number; taxRate?: number; tag?: string; subTags?: string[] }[] };
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // 出力トークン上限などでJSONが途中で切れた場合、末尾の未完成な要素を
      // 切り捨てて配列を閉じ、そこまで読み取れた品目だけでも救出する。
      const repaired = repairTruncatedJson(rawText.replace(/```json|```/g, '').trim());
      if (!repaired) {
        return json({ error: 'OCR解析に失敗しました', raw: rawText }, 500);
      }
      parsed = repaired;
    }

    await sb.rpc('increment_receipt_usage', {
      p_user_id: user.id,
      p_month_key: monthKey,
    });

    const cleanItems = (parsed.items || [])
      .filter(i => i.name && i.amount !== undefined)
      .map(i => ({
        name: i.name,
        amount: i.amount,
        taxRate: i.taxRate === 8 ? 8 : 10,
        tagId: i.tag ? (tagNameToId.get(i.tag) || null) : null,
        tagName: i.tag || '',
        subTagIds: (i.subTags || [])
          .map((name: string) => tagNameToId.get(name))
          .filter((id): id is string => !!id),
      }));

    // ── 検算：印字されている合計とAIが読み取った品目の合計を突き合わせる ──
    // ハルシネーションで品目名・金額ごと辻褄合わせされていた場合、件数や個別の値だけでは
    // 検知できないため、レシートに実際に印字されている合計（totalフィールド）という
    // 独立した数値との整合性チェックを最後の砦として設ける。
    const printedTotal = typeof parsed.total === 'number' ? parsed.total : 0;
    const calculatedTotal = cleanItems.reduce((s, i) => s + i.amount, 0);
    const totalMismatch = printedTotal > 0 && Math.abs(printedTotal - calculatedTotal) > 1;

    return json({
      store: parsed.store || '',
      date: parsed.date || '',
      items: cleanItems,
      printedTotal,
      calculatedTotal,
      totalMismatch,
      count: currentCount + 1,
      limit,
      isPremium,
      usedModel: modelString,
    });

  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : 'エラーが発生しました';
    return json({ error: msg }, 500);
  }
});
