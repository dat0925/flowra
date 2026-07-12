import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const WEBHOOK_SECRET       = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_ROLE_KEY')!;

// Stripe Price ID → プラン名
const PRICE_PLAN: Record<string, string> = {
  [Deno.env.get('STRIPE_PREMIUM_PRICE_ID') ?? '']: 'premium',
};

Deno.serve(async (req) => {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('Webhook signature error:', msg);
    return new Response(`Webhook error: ${msg}`, { status: 400 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // email → user_id を引く（listUsers はデフォルト50件/ページのため必ずページ送りする）
  // ユーザーが50人を超えると先頭ページしか見ず照合に失敗し得るため全件走査する
  async function findUserIdByEmail(email: string): Promise<string | null> {
    const target = email.trim().toLowerCase();
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) { console.error('listUsers error:', error.message); return null; }
      const users = data?.users ?? [];
      const found = users.find((u) => (u.email ?? '').toLowerCase() === target);
      if (found) return found.id;
      if (users.length < 200) break; // 最終ページ
    }
    return null;
  }

  // user_id を解決するヘルパー
  // client_reference_id にSupabase user_idが埋め込まれている前提
  // なければ email → auth.users から user_id を引く
  async function resolveUserId(userId: string | null, email: string | null): Promise<string | null> {
    if (userId) return userId;
    if (!email) return null;
    return await findUserIdByEmail(email);
  }

  try {
    switch (event.type) {

      // 決済完了 → Premiumに更新
      case 'checkout.session.completed': {
        const session    = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;

        // client_reference_id にSupabase user_idを埋め込んでいる
        const refUserId = session.client_reference_id || null;
        const email = session.customer_details?.email ?? session.customer_email ?? null;

        // ログイン中ユーザー(client_reference_id)と決済者(email)の食い違いを可視化する
        // 例：「梗華のIDでリンクを開いたが、支払いは別人のカード/メール」
        // 挙動は変えず(ref優先のまま)、ログだけ残して後から追えるようにする
        if (refUserId && email) {
          const emailUserId = await findUserIdByEmail(email);
          if (emailUserId && emailUserId !== refUserId) {
            console.warn(
              `client_reference_id mismatch (checkout): ref=${refUserId} payerEmail=${email} emailUser=${emailUserId} session=${session.id} -> using ref`
            );
          }
        }

        const userId = await resolveUserId(refUserId, email);
        if (!userId) {
          console.error(
            `user_id NOT FOUND (checkout): session=${session.id} ref=${refUserId} email=${email} customer=${customerId} -> plan NOT updated`
          );
          break;
        }

        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const priceId   = lineItems.data[0]?.price?.id ?? '';
        const plan      = PRICE_PLAN[priceId] ?? 'premium';

        const { error } = await sb.from('user_plans').upsert(
          { user_id: userId, plan, stripe_customer_id: customerId, expires_at: null, cancel_at_period_end: false, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
        if (error) console.error('upsert error (checkout):', error.message);
        else console.log('Plan updated (checkout):', userId, '→', plan);
        break;
      }

      // サブスク作成
      case 'customer.subscription.created': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        if (sub.status !== 'active') break;

        const priceId = sub.items.data[0]?.price?.id ?? '';
        const plan    = PRICE_PLAN[priceId] ?? 'premium';

        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const email    = customer.email;
        const refUserId = (customer.metadata?.supabase_uid) || null;

        const userId = await resolveUserId(refUserId, email);
        if (!userId) {
          console.error(
            `user_id NOT FOUND (sub created): customer=${customerId} uid=${refUserId} email=${email} -> plan NOT updated`
          );
          break;
        }

        const { error } = await sb.from('user_plans').upsert(
          { user_id: userId, plan, stripe_customer_id: customerId, expires_at: null, cancel_at_period_end: false, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
        if (error) console.error('upsert error (sub created):', error.message);
        else console.log('Subscription created:', userId, '→', plan);
        break;
      }

      // 解約完了（期間終了到達）→ Freeに戻す（ただし管理者アカウント(plan='admin')は対象外）
      case 'customer.subscription.deleted': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const { data, error } = await sb.from('user_plans')
          .update({ plan: 'free', expires_at: null, cancel_at_period_end: false, updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', customerId)
          .neq('plan', 'admin') // 管理者は課金状況に関わらずfreeへ降格させない
          .select();
        if (error) console.error('update error (sub deleted):', error.message);
        else if (!data || data.length === 0) {
          console.warn(`sub deleted but no user_plans row matched: customer=${customerId}`);
        } else {
          console.log('Downgraded to free: customer', customerId, `(${data.length} row)`);
        }
        break;
      }

      // プラン変更・解約予約/取り消し
      // ※ cancel_at_period_end / cancel_at を expires_at に反映する処理がこれまで
      //   存在せず、「解約したがいつ終了するか」をUIに一切出せなかった。今回追加。
      // 管理者アカウント(plan='admin')はWebhookで上書きしない。
      case 'customer.subscription.updated': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        if (sub.status !== 'active') break;

        const priceId = sub.items.data[0]?.price?.id ?? '';
        const plan    = PRICE_PLAN[priceId];
        if (!plan) break;

        const cancelAtPeriodEnd = sub.cancel_at_period_end ?? false;
        const expiresAt = cancelAtPeriodEnd && sub.cancel_at
          ? new Date(sub.cancel_at * 1000).toISOString()
          : null;

        const { error } = await sb.from('user_plans')
          .update({ plan, expires_at: expiresAt, cancel_at_period_end: cancelAtPeriodEnd, updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', customerId)
          .neq('plan', 'admin'); // 管理者プランはWebhookで上書きしない
        if (error) console.error('update error (sub updated):', error.message);
        else console.log('Plan changed: customer', customerId, '→', plan, 'expiresAt:', expiresAt, 'cancelAtPeriodEnd:', cancelAtPeriodEnd);
        break;
      }
    }
  } catch (e: unknown) {
    console.error('Handler error:', e instanceof Error ? e.message : e);
    return new Response('Internal error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
