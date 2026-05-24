// ─────────────────────────────────────
//  config.js  Supabase クライアント設定
// ─────────────────────────────────────
//
// Supabase Dashboard → Settings → API から取得
// SUPABASE_URL      : Project URL
// SUPABASE_ANON_KEY : anon / public key
//
const SUPABASE_URL      = 'https://copyzpsyagscqrvkrwjo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvcHl6cHN5YWdzY3Fydmtyd2pvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTI4NTEsImV4cCI6MjA5NTE4ODg1MX0.4g0Rzo4TyM0NPWF53swUWhLD4nDYMSOD7KB9ZBW80Kc';

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
