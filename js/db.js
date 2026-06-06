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
    if (!data || data.length === 0) throw new Error('RLSにより更新が拒否されました。Supabaseのポリシーを確認してください。');
    // キャッシュをリセット
    _allTeams = null;
    return data[0];
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
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('accounts')
      .insert({ ...payload, team_id: teamId, created_by: user.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // 口座に紐づく取引件数を取得（非公開切り替え可否の判定用）
  async getTransactionCountForAccount(accountId) {
    const teamId = await this.getTeamId();
    const { count, error } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`);
    if (error) throw error;
    return count || 0;
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

  async reorderTags(tags) {
    // sort_order を 0,1,2... に正規化してから一括更新（口座と同じパターン）
    const updates = tags.map((t, i) => this.updateTag(t.id, { sort_order: i }));
    await Promise.all(updates);
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
      tags: (tx.transaction_tags || []).map(tt => tt.tag).filter(t => t)
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
    let inserted = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE).map(r => ({
        ...(r.id ? { id: r.id } : {}),
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

      // 1回リトライ
      let error;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await supabase.from('transactions').insert(chunk);
        error = res.error;
        if (!error) { inserted += chunk.length; break; }
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
      if (error) importErrors.push({ chunkStart: i, count: chunk.length, message: error.message });

      done = Math.min(i + CHUNK_SIZE, rows.length);
      if (progressCallback) progressCallback(done, rows.length, importErrors.length);
    }

    return { total: rows.length, inserted, errors: importErrors };
  },

  // 全件をページネーションしてIndexedDBに投入する（インポート後のキャッシュ再構築用）
  // onProgress(done, total) でカウントを通知
  async fetchAllToCache(onProgress) {
    const { upsertTransactions } = await import('./cache.js');
    const PAGE = 500;
    let page  = 0;
    let total = null;
    let done  = 0;
    while (true) {
      const result = await this.getTransactions({ page, pageSize: PAGE });
      if (total === null) total = result.count;
      if (result.data.length > 0) {
        await upsertTransactions(result.data);
        done += result.data.length;
        if (onProgress) onProgress(done, total);
      }
      if (!result.hasMore) break;
      page++;
    }
    return done;
  },

  // キーワード全期間検索（Supabase直接）
  // memo / タグ名 / 口座名に対してilike検索
  async searchTransactions(keyword, type = 'all') {
    const teamId = await this.getTeamId();
    const q = keyword.trim();
    if (!q) return [];

    // タグ名でヒットするtag_idを先に取得
    const { data: matchedTags } = await supabase
      .from('tags')
      .select('id')
      .eq('team_id', teamId)
      .ilike('name', `%${q}%`);
    const tagIds = (matchedTags || []).map(t => t.id);

    // 口座名でヒットするaccount_idを取得
    const { data: matchedAccounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('team_id', teamId)
      .ilike('name', `%${q}%`);
    const acctIds = (matchedAccounts || []).map(a => a.id);

    // transaction_tagsでtagIdsに紐づくtransaction_idを取得
    let tagTxIds = [];
    if (tagIds.length > 0) {
      const { data: tagTxRows } = await supabase
        .from('transaction_tags')
        .select('transaction_id')
        .in('tag_id', tagIds);
      tagTxIds = (tagTxRows || []).map(r => r.transaction_id);
    }

    // メイン検索: memo ilike OR account_id in OR id in(tagTxIds)
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
      .order('created_at', { ascending: false })
      .limit(500);

    // OR条件を構築
    const orParts = [`memo.ilike.%${q}%`];
    if (acctIds.length > 0) orParts.push(`account_id.in.(${acctIds.join(',')})`);
    if (tagTxIds.length > 0) orParts.push(`id.in.(${tagTxIds.join(',')})`);
    query = query.or(orParts.join(','));

    if (type !== 'all') query = query.eq('type', type);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(tx => ({
      ...tx,
      tags: (tx.transaction_tags || []).map(tt => tt.tag).filter(t => t)
    }));
  },

  // 差分インポート用: 既存レコードの "date|amount|type" キーセットを返す
  async getAllTransactionKeys() {
    const teamId = await this.getTeamId();
    const keys = new Set();
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('transactions')
        .select('date, amount, type, memo')
        .eq('team_id', teamId)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) {
        keys.add(`${r.date}|${r.amount}|${r.type}|${(r.memo||'').slice(0,30)}`);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return keys;
  },

  async bulkInsertTransactionTags(tagRows, progressCallback) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < tagRows.length; i += CHUNK_SIZE) {
      const chunk = tagRows.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase.from('transaction_tags').insert(chunk);
      if (error) console.warn('tag insert error:', error.message);
      if (progressCallback) progressCallback(Math.min(i + CHUNK_SIZE, tagRows.length), tagRows.length);
    }
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
    if (!user) throw new Error('ログインが必要です。Googleアカウントでログインしてから再度お試しください。');
    // 招待を取得
    const invite = await this.getInviteByToken(token);
    if (!invite) throw new Error('招待が見つかりません');
    if (invite.used_at) throw new Error('この招待リンクは既に使用済みです');
    if (new Date(invite.expires_at) < new Date()) throw new Error('招待リンクの有効期限が切れています');

    // 既にメンバーか確認（team_membersにidカラムはないためteam_idで代替）
    const { data: existing } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('team_id', invite.team_id)
      .eq('user_id', user.id)
      .maybeSingle();
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

    // チームIDキャッシュをリセットして招待元チームをアクティブに設定
    _teamId = null;
    _allTeams = null;
    this.setActiveTeamId(invite.team_id);
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

  // ── 予算 ────────────────────────────────────────────

  // 予算一覧取得（デフォルト + 指定月の上書き）
  // month: 'YYYY-MM' または null（全件）
  async getBudgets(month) {
    const teamId = await this.getTeamId();
    let query = supabase
      .from('budgets')
      .select('id, tag_id, month, amount')
      .eq('team_id', teamId);
    if (month) {
      // デフォルト（month IS NULL）と指定月の両方を取得
      query = query.or(`month.is.null,month.eq.${month}`);
    } else {
      query = query.is('month', null);
    }
    const { data, error } = await query;
    if (error) throw error;
    // 指定月の上書きを優先したマップを返す
    const map = {};
    (data || []).forEach(b => {
      if (!map[b.tag_id] || b.month !== null) map[b.tag_id] = b;
    });
    return map; // { tag_id: budget }
  },

  // 予算をUpsert（デフォルト or 月別）
  async upsertBudget(tagId, amount, month = null) {
    const teamId = await this.getTeamId();
    // 既存レコードを検索
    let query = supabase.from('budgets')
      .select('id')
      .eq('team_id', teamId)
      .eq('tag_id', tagId);
    if (month) query = query.eq('month', month);
    else       query = query.is('month', null);
    const { data: existing } = await query.maybeSingle();

    if (amount === 0 || amount === null) {
      // 金額0は削除
      if (existing) {
        const { error } = await supabase.from('budgets').delete().eq('id', existing.id);
        if (error) throw error;
      }
      return null;
    }

    const payload = { team_id: teamId, tag_id: tagId, amount, month };
    let error;
    if (existing) {
      ({ error } = await supabase.from('budgets').update({ amount }).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('budgets').insert(payload));
    }
    if (error) throw error;
  },

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
  },

  // ── AI使用量・プラン ─────────────────────

  // 無料プランの月次AI上限
  FREE_AI_LIMIT: 5,

  // Premiumプランの月次AI上限（月6,000回 = 1日200回、実質使い切れない設計）
  PREMIUM_AI_LIMIT: 6000,

  // 今月のAI使用回数を取得（テーブルがなければ0を返す）
  async getAiUsageThisMonth() {
    const { data: { user } } = await supabase.auth.getUser();
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const { data, error } = await supabase
      .from('ai_usage')
      .select('count')
      .eq('user_id', user.id)
      .eq('month_key', monthKey)
      .maybeSingle();
    if (error) return 0; // テーブル未作成でも0を返す
    return data?.count ?? 0;
  },

  // AI使用回数をインクリメント（Edge Function呼び出し前に実行）
  async incrementAiUsage() {
    const { data: { user } } = await supabase.auth.getUser();
    const monthKey = new Date().toISOString().slice(0, 7);
    const { error } = await supabase.rpc('increment_ai_usage', {
      p_user_id: user.id,
      p_month_key: monthKey,
    });
    if (error) console.warn('[DB] increment_ai_usage failed:', error.message);
  },

  // ユーザーのプランを取得（'free' | 'premium'）
  async getUserPlan() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('user_plans')
      .select('plan, expires_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error || !data) return 'free';
    // expires_atが過去ならfreeに降格
    if (data.expires_at && new Date(data.expires_at) < new Date()) return 'free';
    return data.plan;
  },

  // Premiumプランかどうか（AI制限判定用）
  async isPremiumplan() {
    const plan = await this.getUserPlan();
    return plan === 'premium';
  },
};
