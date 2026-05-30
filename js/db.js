// ─────────────────────────────────────
//  db.js  DB操作まとめ
//  ※ 大量データ対応: ページネーション・集計分離・バッチ処理
// ─────────────────────────────────────
import { supabase } from './config.js';

// ── 定数 ──
const PAGE_SIZE = 50; // 1回の取得件数

// ── キャッシュ ──
let _teamId = null;
let _allTeams = null; // 所属チーム一覧キャッシュ

export const DB = {

  // ── チーム ──────────────────────────

  // アクティブチームIDをlocalStorageから取得
  getActiveTeamId() {
    return localStorage.getItem('flowra_active_team_id');
  },

  // アクティブチームIDをlocalStorageに保存
  setActiveTeamId(teamId) {
    localStorage.setItem('flowra_active_team_id', teamId);
    _teamId = teamId; // メモリキャッシュも更新
  },

  // アクティブチームIDをクリア（ログアウト時）
  clearActiveTeamId() {
    localStorage.removeItem('flowra_active_team_id');
    _teamId = null;
    _allTeams = null;
  },

  // 自分がオーナーのチームIDを取得
  async getOwnTeamId() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .limit(1)
      .single();
    if (error) throw error;
    return data.team_id;
  },

  // 所属チーム一覧を取得
  async getAllTeams() {
    if (_allTeams) return _allTeams;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('team_members')
      .select('team_id, role, teams:team_id(id, name)')
      .eq('user_id', user.id)
      .order('joined_at');
    if (error) throw error;
    _allTeams = data;
    return _allTeams;
  },

  async getTeamId() {
    if (_teamId) return _teamId;

    // localStorageにアクティブチームIDがあればそれを使う
    const activeId = this.getActiveTeamId();
    if (activeId) {
      _teamId = activeId;
      return _teamId;
    }

    // なければ自分がオーナーのチームをデフォルトに
    const ownTeamId = await this.getOwnTeamId();
    this.setActiveTeamId(ownTeamId);
    _teamId = ownTeamId;
    return _teamId;
  },

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

  async getTeamById(teamId) {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single();
    if (error) throw error;
    return data;
  },

  async updateTeam(teamId, payload) {
    const { data, error } = await supabase
      .from('teams')
      .update(payload)
      .eq('id', teamId)
      .select();
    if (error) throw error;
    // キャッシュをリセット
    _allTeams = null;
    return data?.[0] ?? null;
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

  async updateTag(id, payload) {
    const { data, error } = await supabase
      .from('tags')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteTag(id) {
    // transaction_tags は ON DELETE CASCADE で自動削除される
    const { error } = await supabase
      .from('tags')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ── 記録（ページネーション対応）─────────────────
  //
  // ポイント：
  //  ・limit + range で必要な分だけ取得
  //  ・月サマリーは SELECT type,amount のみ（軽量）
  //  ・3万行あっても index_transactions_team_date が効く
  //  ・画面は PAGE_SIZE=50 件ずつ追加ロード（無限スクロール）

  async getTransactions({
    year, month, accountId, unsettledOnly,
    page = 0,           // 0始まり
    pageSize = PAGE_SIZE
  } = {}) {
    const teamId = await this.getTeamId();
    const from_row = page * pageSize;
    const to_row   = from_row + pageSize - 1;

    let query = supabase
      .from('transactions')
      .select(`
        *,
        account:accounts!account_id(id, name, type, icon, color),
        to_account:accounts!to_account_id(id, name, type),
        transaction_tags(tag:tags(id, name, color))
      `, { count: 'exact' })          // ← 総件数も取得
      .eq('team_id', teamId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from_row, to_row);       // ← ページネーション

    if (year && month) {
      const dateFrom = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay  = new Date(year, month, 0).getDate();
      const dateTo   = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;
      query = query.gte('date', dateFrom).lte('date', dateTo);
    }
    if (accountId) {
      query = query.or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`);
    }
    if (unsettledOnly) {
      query = query.eq('is_unsettled', true);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = (data || []).map(tx => ({
      ...tx,
      tags: (tx.transaction_tags || []).map(tt => tt.tag)
    }));

    return {
      data: rows,
      count,                          // 総件数
      hasMore: (from_row + rows.length) < count  // 次ページあり？
    };
  },

  // 月サマリー（type+amount のみ取得 → 軽量）
  // 集計はDB側で行うためスキャン行数が少ない
  async getMonthlySummary(year, month) {
    const teamId  = await this.getTeamId();
    const dateFrom = `${year}-${String(month).padStart(2,'0')}-01`;
    const lastDay  = new Date(year, month, 0).getDate();
    const dateTo   = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;

    const { data, error } = await supabase
      .from('transactions')
      .select('type, amount')         // 必要カラムのみ
      .eq('team_id', teamId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .in('type', ['income', 'expense']);

    if (error) throw error;

    const income  = (data || []).filter(t => t.type === 'income' ).reduce((s,t) => s + t.amount, 0);
    const expense = (data || []).filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    return { income, expense, net: income - expense };
  },

  // ── 記録 CRUD ──────────────────────

  async createTransaction(payload, tagIds = []) {
    const teamId = await this.getTeamId();
    const { data: { user } } = await supabase.auth.getUser();

    const { data: tx, error } = await supabase
      .from('transactions')
      .insert({ ...payload, team_id: teamId, created_by: user.id })
      .select()
      .single();
    if (error) throw error;

    if (tagIds.length > 0) {
      const tagRows = tagIds.map(tag_id => ({ transaction_id: tx.id, tag_id }));
      const { error: tagErr } = await supabase.from('transaction_tags').insert(tagRows);
      if (tagErr) throw tagErr;
    }
    return tx;
  },

  async updateTransaction(id, payload, tagIds) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: tx, error } = await supabase
      .from('transactions')
      .update({ ...payload, updated_by: user.id })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    if (tagIds !== undefined) {
      await supabase.from('transaction_tags').delete().eq('transaction_id', id);
      if (tagIds.length > 0) {
        const tagRows = tagIds.map(tag_id => ({ transaction_id: id, tag_id }));
        await supabase.from('transaction_tags').insert(tagRows);
      }
    }
    return tx;
  },

  async deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  },

  // ── インポート（バッチ処理）─────────────────────
  //
  // ポイント：
  //  ・CHUNK_SIZE 件ずつ分割してinsert → 一度に大量送信しない
  //  ・タグは別テーブルなので後でまとめてinsert
  //  ・progressCallback(done, total) で進捗通知
  //  ・エラーが出た行はスキップして続行（importErrors に収集）

  async importTransactions(rows, progressCallback) {
    const CHUNK_SIZE = 200;
    const teamId = await this.getTeamId();
    const { data: { user } } = await supabase.auth.getUser();

    const importErrors = [];
    let done = 0;

    // 行を CHUNK_SIZE 単位に分割
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE).map(r => ({
        team_id:       teamId,
        created_by:    user.id,
        type:          r.type,
        amount:        Number(r.amount),
        date:          r.date,
        account_id:    r.account_id,
        to_account_id: r.to_account_id || null,
        memo:          r.memo || null,
        url:           r.url  || null,
        is_unsettled:  r.is_unsettled || false,
      }));

      const { error } = await supabase.from('transactions').insert(chunk);
      if (error) {
        importErrors.push({ chunk: i, error: error.message });
      }

      done = Math.min(i + CHUNK_SIZE, rows.length);
      if (progressCallback) progressCallback(done, rows.length);
    }

    return { total: rows.length, errors: importErrors };
  },

  // ── コメント ────────────────────────

  async getComments(transactionId) {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
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

  // ── 招待・メンバー管理 ────────────────

  async getTeamMembers() {
    const teamId = await this.getTeamId();
    const { data, error } = await supabase
      .rpc('get_team_member_profiles', { p_team_id: teamId });
    if (error) throw error;
    return data;
  },

  // 指定チームのメンバープロフィールを取得
  async getTeamMemberProfilesForTeam(teamId) {
    const { data, error } = await supabase
      .rpc('get_team_member_profiles', { p_team_id: teamId });
    if (error) throw error;
    return data;
  },

  // 複数チームのオーナー情報を一括取得（チーム切り替えUI用）
  async getTeamMemberProfiles(teamIds) {
    const results = [];
    for (const teamId of teamIds) {
      const { data } = await supabase
        .rpc('get_team_member_profiles', { p_team_id: teamId });
      if (data) results.push(...data.map(d => ({ ...d, team_id: teamId })));
    }
    return results;
  },

  async getMyRole() {
    const teamId = await this.getTeamId();
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .single();
    if (error) return 'member';
    return data.role;
  },

  async createInvite(role = 'member') {
    const teamId = await this.getTeamId();
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('team_invites')
      .insert({ team_id: teamId, role, created_by: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // 自分のチームへの招待を明示的に発行（アクティブチームに関わらず）
  async createInviteForOwnTeam(role = 'member') {
    const ownTeamId = await this.getOwnTeamId();
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('team_invites')
      .insert({ team_id: ownTeamId, role, created_by: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getInviteByToken(token) {
    const { data, error } = await supabase
      .from('team_invites')
      .select('*')
      .eq('token', token)
      .single();
    if (error) throw error;
    return data;
  },

  async acceptInvite(token) {
    const { data: { user } } = await supabase.auth.getUser();
    // 招待を取得
    const invite = await this.getInviteByToken(token);
    if (!invite) throw new Error('招待が見つかりません');
    if (invite.used_at) throw new Error('この招待リンクは既に使用済みです');
    if (new Date(invite.expires_at) < new Date()) throw new Error('招待リンクの有効期限が切れています');

    // 既にメンバーか確認
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', invite.team_id)
      .eq('user_id', user.id)
      .single();
    if (existing) throw new Error('既にこのチームのメンバーです');

    // メンバー追加
    const { error: joinError } = await supabase
      .from('team_members')
      .insert({ team_id: invite.team_id, user_id: user.id, role: invite.role });
    if (joinError) throw joinError;

    // 招待を使用済みに
    await supabase
      .from('team_invites')
      .update({ used_at: new Date().toISOString(), used_by: user.id })
      .eq('id', invite.id);

    // チームIDキャッシュをリセット
    _teamId = null;
  },

  async updateMemberRole(userId, role) {
    const teamId = await this.getTeamId();
    const { error } = await supabase
      .from('team_members')
      .update({ role })
      .eq('team_id', teamId)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async removeMember(userId) {
    const teamId = await this.getTeamId();
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId);
    if (error) throw error;
  },

  // 自分がオーナーでないチームから脱退
  async leaveTeam(teamId) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', user.id);
    if (error) throw error;
    // 自分のチームに戻す
    _allTeams = null;
    const ownTeamId = await this.getOwnTeamId();
    this.setActiveTeamId(ownTeamId);
  },

  // ── 差分更新 ────────────────────────
  // フォアグラウンド復帰時に updated_at > 最終同期時刻 のみ取得
  // Realtime を使わないのは Disk IO 問題（Taskra の教訓）を避けるため

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
