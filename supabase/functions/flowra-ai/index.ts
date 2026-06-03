import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { question, data } = await req.json();
    const {
      year, month, income, expense,
      tagBreakdown = [],
      budgets = [],
      prevIncome = 0, prevExpense = 0, prevTagBreakdown = [],
      todayDate,        // 例: 3  (何日時点か)
      daysInMonth,      // 例: 30
    } = data;

    const today    = todayDate  ?? new Date().getDate();
    const totalDays = daysInMonth ?? new Date(year, month, 0).getDate();
    const elapsed  = Math.round((today / totalDays) * 100);
    const isEarly  = today <= 10;
    const isMid    = today > 10 && today <= 20;
    const monthContext = isEarly
      ? `今日は${month}月${today}日で月初（月の約${elapsed}%経過）。まだデータが少ないため、月全体の評価は控えて現時点の傾向だけコメントすること。`
      : isMid
      ? `今日は${month}月${today}日で月の中盤（約${elapsed}%経過）。現時点のペースをもとにコメントすること。`
      : `今日は${month}月${today}日で月末に近い（約${elapsed}%経過）。月全体の傾向をコメントしてよい。`;

    const tagLines = tagBreakdown.map((t: any) =>
      `  ${t.name}: ¥${t.amount.toLocaleString()}${
        budgets.find((b: any) => b.tagId === t.tagId)
          ? `（予算¥${budgets.find((b: any) => b.tagId === t.tagId).amount.toLocaleString()}）`
          : ""
      }`
    ).join("\n");

    const prevTagLines = prevTagBreakdown.map((t: any) =>
      `  ${t.name}: ¥${t.amount.toLocaleString()}`
    ).join("\n");

    const systemPrompt = `あなたは家計アドバイザーです。夫婦・カップルの家計データを見て、短く・具体的・ポジティブなアドバイスをします。
- 回答は2〜3文以内。箇条書き不可。数字を使って具体的に。
- 月途中なら月全体の評価・予測をしない。現時点の傾向だけ述べる。
- 収入がある月はそれを踏まえてコメントする（収入を無視して赤字と言わない）。
- 日本語で答える。`;

    const prompts: Record<string, string> = {
      monthly: `${monthContext}
収入: ¥${income.toLocaleString()}、支出: ¥${expense.toLocaleString()}、収支: ¥${(income - expense).toLocaleString()}
支出内訳:\n${tagLines || "  データなし"}
この状況を2〜3文で一言コメントしてください。`,

      compare: `${monthContext}
今月（${month}月）: 収入¥${income.toLocaleString()} 支出¥${expense.toLocaleString()}
先月: 収入¥${prevIncome.toLocaleString()} 支出¥${prevExpense.toLocaleString()}
今月の支出内訳:\n${tagLines || "  データなし"}
先月の支出内訳:\n${prevTagLines || "  データなし"}
先月との違いを具体的に2〜3文で教えてください。`,

      saving: `${monthContext}
収入: ¥${income.toLocaleString()}、支出: ¥${expense.toLocaleString()}
支出内訳:\n${tagLines || "  データなし"}
${budgets.length ? `予算設定:\n${budgets.map((b: any) => `  ${b.name}: ¥${b.amount.toLocaleString()}`).join("\n")}` : ""}
節約できそうな点を具体的に2〜3文で教えてください。`,
    };

    const userMessage = prompts[question] ?? prompts.monthly;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const json = await res.json();
    const answer = json.content?.[0]?.text ?? "回答を取得できませんでした。";

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
