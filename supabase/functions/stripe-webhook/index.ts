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

  // user_id を解決するヘルパー
  // client_reference_id にSupabase user_idが埋め込まれている前提
  // なければ email → auth.users から user_id を引く
  async function resolveUserId(userId: string | null, email: string | null): Promise<string | null> {
    if (userId) return userId;
    if (!email) return null;
    const { data } = await sb.auth.admin.listUsers();
    const found = data?.users?.find((u) => u.email === email);
    return found?.id ?? null;
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

        const userId = await resolveUserId(refUserId, email);
        if (!userId) { console.error('user_id not found', session.id); break; }

        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const priceId   = lineItems.data[0]?.price?.id ?? '';
        const plan      = PRICE_PLAN[priceId] ?? 'premium';

        const { error } = await sb.from('user_plans').upsert(
          { user_id: userId, plan, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
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
        if (!userId) { console.error('user_id not found for customer', customerId); break; }

        const { error } = await sb.from('user_plans').upsert(
          { user_id: userId, plan, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
        if (error) console.error('upsert error (sub created):', error.message);
        else console.log('Subscription created:', userId, '→', plan);
        break;
      }

      // 解約 → Freeに戻す
      case 'customer.subscription.deleted': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const { error } = await sb.from('user_plans')
          .update({ plan: 'free', updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', customerId);
        if (error) console.error('update error (sub deleted):', error.message);
        else console.log('Downgraded to free: customer', customerId);
        break;
      }

      // プラン変更
      case 'customer.subscription.updated': {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        if (sub.status !== 'active') break;

        const priceId = sub.items.data[0]?.price?.id ?? '';
        const plan    = PRICE_PLAN[priceId];
        if (!plan) break;

        const { error } = await sb.from('user_plans')
          .update({ plan, updated_at: new Date().toISOString() })
          .eq('stripe_customer_id', customerId);
        if (error) console.error('update error (sub updated):', error.message);
        else console.log('Plan changed: customer', customerId, '→', plan);
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
