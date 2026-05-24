// ─────────────────────────────────────
//  auth.js  Google OAuth 認証
// ─────────────────────────────────────
import { supabase } from './config.js';

export const Auth = {

  // 現在のセッション取得
  async getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  // 現在のユーザー取得
  async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  // Google ログイン
  async signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        queryParams: { prompt: 'select_account' },
        redirectTo: window.location.origin,
      }
    });
    if (error) console.error('Login error:', error);
  },

  // ログアウト
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Logout error:', error);
    window.location.reload();
  },

  // 認証状態変化のリスナー
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },

  // ユーザー名の頭文字（アバター用）
  getInitial(user) {
    if (!user) return '?';
    const name = user.user_metadata?.full_name || user.email || '';
    return name.charAt(0).toUpperCase();
  },

  // 表示名
  getDisplayName(user) {
    if (!user) return '';
    return user.user_metadata?.full_name || user.email || '';
  }
};
