import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.3?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SB_ANON_KEY  = Deno.env.get('SB_ANON_KEY')!;
const SB_SVC_KEY   = Deno.env.get('SB_SERVICE_ROLE_KEY')!;

// レシートOCRの月次上限
const FREE_RECEIPT_LIMIT    = 3;
const PREMIUM_RECEIPT_LIMIT = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // JWT認証
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '認証が必要です' }, 401);

    const sbAnon = createClient(SUPABASE_URL, SB_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await sbAnon.auth.getUser();
    if (authError || !user) return json({ error: 'ログインが必要です' }, 401);

    const sb = createClient(SUPABASE_URL, SB_SVC_KEY);

    // プラン取得
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

    // 今月の使用回数確認（receipt_usage テーブル）
    const monthKey = new Date().toISOString().slice(0, 7);
    const { data: usageRow } = await sb
      .from('receipt_usage')
      .select('count')
      .eq('user_id', user.id)
      .eq('month_key', monthKey)
      .maybeSingle();
    const currentCount = usageRow?.count ?? 0;

    if (currentCount >= limit) {
      return json({
        error: 'LIMIT_REACHED',
        limit,
        count: currentCount,
        isPremium,
      }, 429);
    }

    // 画像を受け取る
    const body = await req.json();
    const { image, mediaType = 'image/jpeg' } = body;
    if (!image) return json({ error: '画像が必要です' }, 400);

    // Claude Vision でOCR
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: image },
          },
          {
            type: 'text',
            text: `このレシートから品目と金額を抽出してください。
以下のJSON形式のみで回答してください（説明文不要）：
{
  "store": "店名（不明なら空文字）",
  "date": "YYYY-MM-DD形式の日付（不明なら空文字）",
  "items": [
    { "name": "品目名", "amount": 金額の数値（税込・値引き後） }
  ]
}

ルール：
- 小計・合計・消費税の行は含めない
- ポイント値引き・割引行はマイナス金額で含める（例: { "name": "ポイント値引き", "amount": -50 }）
- 金額は数値のみ（¥や円は含めない）
- 読み取れない品目はスキップ`
          }
        ]
      }]
    });

    const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
    let parsed: { store: string; date: string; items: { name: string; amount: number }[] };
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: 'OCR解析に失敗しました', raw: rawText }, 500);
    }

    // 使用回数インクリメント
    await sb.rpc('increment_receipt_usage', {
      p_user_id: user.id,
      p_month_key: monthKey,
    });

    return json({
      store: parsed.store || '',
      date: parsed.date || '',
      items: (parsed.items || []).filter(i => i.name && i.amount !== undefined),
      count: currentCount + 1,
      limit,
      isPremium,
    });

  } catch (e) {
    console.error(e);
    return json({ error: 'エラーが発生しました' }, 500);
  }
});
