// notion-proxy  – Notion API の CORSプロキシ
// Supabase Edge Functions (Deno)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notion-token, x-notion-cursor',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const NOTION_DB_ID = '1dd85cf70c4c8055949bf3ad4ecf7ef0';
const NOTION_VER   = '2022-06-28';

Deno.serve(async (req: Request) => {
  // プリフライトリクエスト
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const notionToken = req.headers.get('x-notion-token');
    if (!notionToken) {
      return new Response(JSON.stringify({ error: 'x-notion-token header required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const cursor: string | null = body.cursor ?? null;

    const queryBody: Record<string, unknown> = {
      page_size: 100,
      // ソート指定必須: 未指定だと Notion API が10,000件で打ち切ることがある
      sorts: [{ property: '日付', direction: 'ascending' }],
    };
    if (cursor) queryBody.start_cursor = cursor;

    const notionRes = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
      {
        method:  'POST',
        headers: {
          'Authorization':  `Bearer ${notionToken}`,
          'Notion-Version': NOTION_VER,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify(queryBody),
      }
    );

    const data = await notionRes.json();

    return new Response(JSON.stringify(data), {
      status:  notionRes.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status:  500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
