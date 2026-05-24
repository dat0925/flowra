// ─────────────────────────────────────
//  db.js  DB操作まとめ
// ─────────────────────────────────────
import { supabase } from './config.js';

// ── キャッシュ ──
let _teamId = null;

// ── チーム ──────────────────────────
export const DB = {

  // 自分のチームIDを取得（キャッシュ付き）
  async getTeamId() {
    if (_teamId) return _teamId;
    const { data, error } = await supabase
      .from('team_members')
      .select('team_id')
      .limit(1)
      .single();
    if (error) throw error;
    _teamId = data.team_id;
    return _teamId;
  },

  // チーム情報取得
  async getTeam() {
    const teamId = await this.getTeamId();
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single();
    if (error) throw error;
    return data;
  },

  // ── 口座 ────────────────────────────
  async getAccounts() {
    const teamId = await this.getTeamId();
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('team_id', teamId)
      .eq('is_archived', false)
      .order('sort_order');
    if (error) throw error;
    return data;
  },

  async createAccount(payload) {
    const teamId = await this.getTeamId();
    const { data, error } = await supabase
      .from('accounts')
      .insert({ ...payload, team_id: teamId })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateAccount(id, payload) {
    const { data, error } = await supabase
      .from('accounts')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── タグ ────────────────────────────
  async getTags() {
    const teamId = await this.getTeamId();
    const { data, error } = await supabase
      .from('tags')
      .select('*')
      .eq('team_id', teamId)
      .order('sort_order');
    if (error) throw error;
    return data;
  },

  async createTag(name, color = '#7A9485') {
    const teamId = await this.getTeamId();
    const { data, error } = await supabase
      .from('tags')
      .insert({ team_id: teamId, name, color })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── 記録 ────────────────────────────

  // 月の記録一覧（タグ込み）
  async getTransactions({ year, month, accountId, unsettledOnly } = {}) {
    const teamId = await this.getTeamId();
    let query = supabase
      .from('transactions')
      .select(`
        *,
        account:accounts!account_id(id, name, type, icon, color),
        to_account:accounts!to_account_id(id, name, type),
        transaction_tags(tag:tags(id, name, color))
      `)
      .eq('team_id', teamId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (year && month) {
      const from = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to   = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;
      query = query.gte('date', from).lte('date', to);
    }
    if (accountId) {
      query = query.or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`);
    }
    if (unsettledOnly) {
      query = query.eq('is_unsettled', true);
    }

    const { data, error } = await query;
    if (error) throw error;

    // タグを整形
    return (data || []).map(tx => ({
      ...tx,
      tags: (tx.transaction_tags || []).map(tt => tt.tag)
    }));
  },

  // 月サマリー（収入・支出合計）
  async getMonthlySummary(year, month) {
    const teamId = await this.getTeamId();
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to   = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;

    const { data, error } = await supabase
      .from('transactions')
      .select('type, amount')
      .eq('team_id', teamId)
      .gte('date', from)
      .lte('date', to)
      .in('type', ['income', 'expense']);

    if (error) throw error;

    const income  = (data || []).filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = (data || []).filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, net: income - expense };
  },

  // 記録追加
  async createTransaction(payload, tagIds = []) {
    const teamId = await this.getTeamId();
    const { data: { user } } = await supabase.auth.getUser();

    const { data: tx, error } = await supabase
      .from('transactions')
      .insert({ ...payload, team_id: teamId, created_by: user.id })
      .select()
      .single();
    if (error) throw error;

    // タグ紐付け
    if (tagIds.length > 0) {
      const tagRows = tagIds.map(tag_id => ({ transaction_id: tx.id, tag_id }));
      const { error: tagErr } = await supabase.from('transaction_tags').insert(tagRows);
      if (tagErr) throw tagErr;
    }
    return tx;
  },

  // 記録更新
  async updateTransaction(id, payload, tagIds) {
    const { data: tx, error } = await supabase
      .from('transactions')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    // タグ更新
    if (tagIds !== undefined) {
      await supabase.from('transaction_tags').delete().eq('transaction_id', id);
      if (tagIds.length > 0) {
        const tagRows = tagIds.map(tag_id => ({ transaction_id: id, tag_id }));
        await supabase.from('transaction_tags').insert(tagRows);
      }
    }
    return tx;
  },

  // 記録削除
  async deleteTransaction(id) {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ── コメント ────────────────────────
  async getComments(transactionId) {
    const { data, error } = await supabase
      .from('comments')
      .select('*, author:auth.users(email, raw_user_meta_data)')
      .eq('transaction_id', transactionId)
      .order('created_at');
    if (error) throw error;
    return data;
  },

  async addComment(transactionId, body) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('comments')
      .insert({ transaction_id: transactionId, body, created_by: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ── 差分更新 ────────────────────────
  // 最終同期時刻以降に updated_at が変わったレコードだけ取得
  async getDelta(since) {
    const teamId = await this.getTeamId();
    const { data, error } = await supabase
      .from('transactions')
      .select('id, updated_at, type, amount, date, account_id, to_account_id, memo, is_unsettled')
      .eq('team_id', teamId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
  }
};
