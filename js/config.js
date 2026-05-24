// ─────────────────────────────────────
//  config.js  Supabase クライアント設定
// ─────────────────────────────────────
//
// Supabase Dashboard → Settings → API から取得
// SUPABASE_URL      : Project URL
// SUPABASE_ANON_KEY : anon / public key
//
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);
