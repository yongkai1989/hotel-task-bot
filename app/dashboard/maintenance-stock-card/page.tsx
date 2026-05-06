'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
  can_access_stock_card?: boolean;
};

type BranchName = 'Crown' | 'Leisure' | 'Express' | 'View';
type MovementType = 'RESTOCK' | 'TAKE_OUT' | 'TRANSFER_IN' | 'TRANSFER_OUT';
type ItemCategory = 'Electrical' | 'Plumbing' | 'Air-Con';

type StockItemRow = {
  id: string;
  item_name: string;
  description: string | null;
  category: ItemCategory | null;
  created_at?: string | null;
};

type StockMovementRow = {
  id: string;
  item_id: string;
  branch_name: BranchName;
  movement_type: MovementType;
  qty: number;
  reason: string | null;
  used_to: string | null;
  created_at?: string | null;
  created_by_name?: string | null;
  transfer_group_id?: string | null;
  damage_reported?: boolean | null;
};

type DamagedRow = {
  id: string;
  item_id: string;
  item_name?: string | null;
  branch_name: BranchName;
  qty: number;
  reason: string | null;
  used_to: string | null;
  replacement_movement_id?: string | null;
  created_at?: string | null;
  created_by_name?: string | null;
};

type ItemSummary = {
  id: string;
  itemName: string;
  description: string;
  category: ItemCategory;
  branchStocks: Record<BranchName, number>;
};

const BRANCHES: BranchName[] = ['Crown', 'Leisure', 'Express', 'View'];
const ITEM_CATEGORIES: ItemCategory[] = ['Electrical', 'Plumbing', 'Air-Con'];

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) return null;

  return createBrowserSupabaseClient();
}

function safeNumber(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function emptyBranchStocks() {
  return {
    Crown: 0,
    Leisure: 0,
    Express: 0,
    View: 0,
  } as Record<BranchName, number>;
}

function normalizeCategory(value: unknown): ItemCategory {
  if (value === 'Electrical' || value === 'Plumbing' || value === 'Air-Con') {
    return value;
  }
  return 'Electrical';
}

function branchBadgeStyle(active: boolean): React.CSSProperties {
  return {
    ...styles.branchPill,
    ...(active ? styles.branchPillActive : {}),
  };
}

export default function MaintenanceStockCardPage() {
  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [items, setItems] = useState<StockItemRow[]>([]);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [damagedRows, setDamagedRows] = useState<DamagedRow[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<BranchName>('Crown');

  const [addItemName, setAddItemName] = useState('');
  const [addItemDescription, setAddItemDescription] = useState('');
  const [addItemCategory, setAddItemCategory] = useState<ItemCategory>('Electrical');
  const [openCategories, setOpenCategories] = useState<Record<ItemCategory, boolean>>({
    Electrical: true,
    Plumbing: false,
    'Air-Con': false,
  });
  const [actionMenuItemId, setActionMenuItemId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'RESTOCK' | 'TAKE_OUT' | 'TRANSFER'>('RESTOCK');
  const [activeItem, setActiveItem] = useState<ItemSummary | null>(null);
  const [movementBranch, setMovementBranch] = useState<BranchName>('Crown');
  const [targetBranch, setTargetBranch] = useState<BranchName>('Leisure');
  const [movementQty, setMovementQty] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [movementUsedTo, setMovementUsedTo] = useState('');
  const [reportDamage, setReportDamage] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const supabase = getSupabaseSafe();
        if (!supabase) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (mounted) setProfile(null);
          return;
        }

        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role, can_access_stock_card')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!mounted) return;

        setProfile({
          user_id: session.user.id,
          email: profileRow?.email || session.user.email || '',
          name: profileRow?.name || session.user.email || 'User',
          role: (profileRow?.role || 'MT') as DashboardUser['role'],
          can_access_stock_card: profileRow?.can_access_stock_card ?? false,
        });
      } catch (err: any) {
        if (mounted) setErrorMsg(err?.message || 'Failed to load session');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  const canAccess = useMemo(() => {
    if (!profile) return false;
    if (profile.role === 'SUPERUSER' || profile.role === 'MANAGER' || profile.role === 'SUPERVISOR') return true;
    return profile.can_access_stock_card === true;
  }, [profile]);

  const isSuperuser = profile?.role === 'SUPERUSER';

  async function loadData() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      const [itemsRes, movementRes, damagedRes] = await Promise.all([
        supabase
          .from('maintenance_stock_items')
          .select('id, item_name, description, category, created_at')
          .order('item_name', { ascending: true }),
        supabase
          .from('maintenance_stock_movements')
          .select('id, item_id, branch_name, movement_type, qty, reason, used_to, created_at, created_by_name, transfer_group_id, damage_reported')
          .order('created_at', { ascending: false }),
        supabase
          .from('maintenance_damaged_items')
          .select('id, item_id, item_name, branch_name, qty, reason, used_to, replacement_movement_id, created_at, created_by_name')
          .order('created_at', { ascending: false }),
      ]);

      if (itemsRes.error) throw itemsRes.error;
      if (movementRes.error) throw movementRes.error;
      if (damagedRes.error) throw damagedRes.error;

      setItems((itemsRes.data || []) as StockItemRow[]);
      setMovements((movementRes.data || []) as StockMovementRow[]);
      setDamagedRows((damagedRes.data || []) as DamagedRow[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load maintenance stock.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }

    void loadData();
  }, [profile, canAccess]);

  const itemSummaries = useMemo(() => {
    return items.map((item) => {
      const branchStocks = emptyBranchStocks();

      movements
        .filter((movement) => movement.item_id === item.id)
        .forEach((movement) => {
          const sign =
            movement.movement_type === 'RESTOCK' || movement.movement_type === 'TRANSFER_IN'
              ? 1
              : -1;
          branchStocks[movement.branch_name] += sign * safeNumber(movement.qty);
        });

      return {
        id: item.id,
        itemName: item.item_name,
        description: item.description || '',
        category: normalizeCategory(item.category),
        branchStocks,
      } satisfies ItemSummary;
    });
  }, [items, movements]);

  const recentMovements = useMemo(() => {
    return movements.slice(0, 8);
  }, [movements]);

  const groupedItems = useMemo(() => {
    const groups: Record<ItemCategory, ItemSummary[]> = {
      Electrical: [],
      Plumbing: [],
      'Air-Con': [],
    };

    itemSummaries.forEach((item) => {
      groups[item.category].push(item);
    });

    return groups;
  }, [itemSummaries]);

  async function handleAddItem() {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    const itemName = addItemName.trim();
    if (!itemName) {
      setErrorMsg('Please enter item or equipment name.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase.from('maintenance_stock_items').insert([
        {
          item_name: itemName,
          description: addItemDescription.trim() || null,
          category: addItemCategory,
          created_by_user_id: profile?.user_id || null,
          created_by_name: profile?.name || profile?.email || null,
        },
      ]);

      if (error) throw error;

      setAddItemName('');
      setAddItemDescription('');
      setAddItemCategory('Electrical');
      setSuccessMsg('Maintenance stock item added.');
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to add stock item.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItem(item: ItemSummary) {
    const supabase = getSupabaseSafe();
    if (!supabase) {
      setErrorMsg('Supabase is not configured.');
      return;
    }

    if (!isSuperuser) {
      setErrorMsg('Only superusers can delete items.');
      return;
    }

    const confirmed = window.confirm(
      `Delete "${item.itemName}"?\n\nThis will also remove its stock movement history and linked damaged records.`
    );

    if (!confirmed) return;

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('maintenance_stock_items')
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      setSuccessMsg(`Deleted ${item.itemName}.`);
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete stock item.');
    } finally {
      setSaving(false);
    }
  }

  function openMovementModal(mode: 'RESTOCK' | 'TAKE_OUT' | 'TRANSFER', item: ItemSummary) {
    setModalMode(mode);
    setActiveItem(item);
    setMovementBranch(selectedBranch);
    setTargetBranch(BRANCHES.find((branch) => branch !== selectedBranch) || 'Leisure');
    setMovementQty('');
    setMovementReason('');
    setMovementUsedTo('');
    setReportDamage(false);
    setModalOpen(true);
    setErrorMsg('');
    setSuccessMsg('');
  }

  function closeMovementModal() {
    if (saving) return;
    setModalOpen(false);
    setActiveItem(null);
    setMovementQty('');
    setMovementReason('');
    setMovementUsedTo('');
    setReportDamage(false);
  }

  function toggleCategory(category: ItemCategory) {
    setOpenCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  }

  function toggleActionMenu(itemId: string) {
    setActionMenuItemId((prev) => (prev === itemId ? null : itemId));
  }

  async function submitMovement() {
    const supabase = getSupabaseSafe();
    if (!supabase || !activeItem) {
      setErrorMsg('Unable to submit stock movement.');
      return;
    }

    const qty = Math.max(0, safeNumber(movementQty));
    if (qty <= 0) {
      setErrorMsg('Please enter a quantity above 0.');
      return;
    }

    if (modalMode === 'TAKE_OUT' && !movementReason.trim()) {
      setErrorMsg('Please enter reason for stock taken out.');
      return;
    }

    if (modalMode === 'TAKE_OUT' && !movementUsedTo.trim()) {
      setErrorMsg('Please enter where the stock is used.');
      return;
    }

    if (modalMode === 'TRANSFER' && movementBranch === targetBranch) {
      setErrorMsg('Transfer source and target branch must be different.');
      return;
    }

    const availableStock = activeItem.branchStocks[movementBranch];
    if ((modalMode === 'TAKE_OUT' || modalMode === 'TRANSFER') && qty > availableStock) {
      setErrorMsg(`Only ${availableStock} stock available in ${movementBranch}.`);
      return;
    }

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      if (modalMode === 'RESTOCK') {
        const { error } = await supabase.from('maintenance_stock_movements').insert([
          {
            item_id: activeItem.id,
            branch_name: movementBranch,
            movement_type: 'RESTOCK',
            qty,
            reason: movementReason.trim() || 'Restock',
            used_to: null,
            created_by_user_id: profile?.user_id || null,
            created_by_name: profile?.name || profile?.email || null,
          },
        ]);

        if (error) throw error;
      }

      if (modalMode === 'TAKE_OUT') {
        const { data: inserted, error } = await supabase
          .from('maintenance_stock_movements')
          .insert([
            {
              item_id: activeItem.id,
              branch_name: movementBranch,
              movement_type: 'TAKE_OUT',
              qty,
              reason: movementReason.trim(),
              used_to: movementUsedTo.trim(),
              damage_reported: reportDamage,
              created_by_user_id: profile?.user_id || null,
              created_by_name: profile?.name || profile?.email || null,
            },
          ])
          .select('id')
          .single();

        if (error) throw error;

        if (reportDamage) {
          const { error: damageError } = await supabase.from('maintenance_damaged_items').insert([
            {
              item_id: activeItem.id,
              item_name: activeItem.itemName,
              branch_name: movementBranch,
              qty,
              reason: movementReason.trim(),
              used_to: movementUsedTo.trim(),
              replacement_movement_id: inserted?.id || null,
              created_by_user_id: profile?.user_id || null,
              created_by_name: profile?.name || profile?.email || null,
            },
          ]);

          if (damageError) throw damageError;
        }
      }

      if (modalMode === 'TRANSFER') {
        const transferGroupId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${activeItem.id}`;

        const { error } = await supabase.from('maintenance_stock_movements').insert([
          {
            item_id: activeItem.id,
            branch_name: movementBranch,
            movement_type: 'TRANSFER_OUT',
            qty,
            reason: movementReason.trim() || `Transfer to ${targetBranch}`,
            used_to: targetBranch,
            transfer_group_id: transferGroupId,
            created_by_user_id: profile?.user_id || null,
            created_by_name: profile?.name || profile?.email || null,
          },
          {
            item_id: activeItem.id,
            branch_name: targetBranch,
            movement_type: 'TRANSFER_IN',
            qty,
            reason: movementReason.trim() || `Transfer from ${movementBranch}`,
            used_to: movementBranch,
            transfer_group_id: transferGroupId,
            created_by_user_id: profile?.user_id || null,
            created_by_name: profile?.name || profile?.email || null,
          },
        ]);

        if (error) throw error;
      }

      setSuccessMsg(
        modalMode === 'RESTOCK'
          ? 'Stock restocked successfully.'
          : modalMode === 'TAKE_OUT'
          ? 'Stock taken out successfully.'
          : 'Stock moved between branches successfully.'
      );
      closeMovementModal();
      await loadData();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save stock movement.');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>Loading...</div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Login required</div>
          <p style={styles.centerText}>Please log in first, then open this page again.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access denied</div>
          <p style={styles.centerText}>You do not have permission to access Maintenance Stock Card.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topBar}>
          <div>
            <div style={styles.pageTitle}>Maintenance Stock Card</div>
            <div style={styles.pageSubTitle}>Manage stock list, transfers, replacements, and damaged item flow.</div>
          </div>
          <div style={styles.topBarActions}>
            <Link href="/dashboard/maintenance-damaged" style={styles.secondaryBtn}>Damaged Page</Link>
            <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Add Item or Equipment</div>
          <div style={styles.formGrid}>
            <select
              value={addItemCategory}
              onChange={(e) => setAddItemCategory(e.target.value as ItemCategory)}
              style={styles.input}
              disabled={saving}
            >
              {ITEM_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <input
              value={addItemName}
              onChange={(e) => setAddItemName(e.target.value)}
              placeholder="Item or equipment name"
              style={styles.input}
              disabled={saving}
            />
            <input
              value={addItemDescription}
              onChange={(e) => setAddItemDescription(e.target.value)}
              placeholder="Description"
              style={styles.input}
              disabled={saving}
            />
            <button
              type="button"
              onClick={handleAddItem}
              style={{ ...styles.primaryBtn, opacity: saving ? 0.65 : 1 }}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Add Item'}
            </button>
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Branch Overview</div>
          <div style={styles.branchRow}>
            {BRANCHES.map((branch) => (
              <button
                key={branch}
                type="button"
                onClick={() => setSelectedBranch(branch)}
                style={branchBadgeStyle(selectedBranch === branch)}
              >
                {branch}
              </button>
            ))}
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Current Stock</div>
          <div style={styles.sectionHint}>
            Viewing branch balance for <strong>{selectedBranch}</strong>. Expand a category to see items.
          </div>

          {loading ? (
            <div style={styles.emptyState}>Loading maintenance stock...</div>
          ) : itemSummaries.length === 0 ? (
            <div style={styles.emptyState}>No maintenance stock items yet.</div>
          ) : (
            <div style={styles.categoryList}>
              {ITEM_CATEGORIES.map((category) => {
                const categoryItems = groupedItems[category];
                const isOpen = openCategories[category];

                return (
                  <section key={category} style={styles.categorySection}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(category)}
                      style={styles.categoryToggle}
                    >
                      <div style={styles.categoryToggleLeft}>
                        <div style={styles.categoryName}>{category}</div>
                        <div style={styles.categoryCount}>
                          {categoryItems.length} item{categoryItems.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div style={styles.categoryChevron}>{isOpen ? 'Hide' : 'Show'}</div>
                    </button>

                    {isOpen ? (
                      categoryItems.length === 0 ? (
                        <div style={styles.emptyStateCompact}>No items in this category yet.</div>
                      ) : (
                        <div style={styles.stockList}>
                          {categoryItems.map((item) => {
                            const branchBalance = item.branchStocks[selectedBranch];
                            const actionOpen = actionMenuItemId === item.id;

                            return (
                              <article key={item.id} style={styles.stockRow}>
                                <div style={styles.stockRowMain}>
                                  <div style={styles.stockRowTop}>
                                    <div style={styles.stockName}>{item.itemName}</div>
                                    <div style={styles.stockBalanceWrap}>
                                      <div style={styles.stockBalanceLabel}>{selectedBranch}</div>
                                      <div style={styles.stockBalanceValue}>{branchBalance}</div>
                                    </div>
                                  </div>

                                  {item.description ? (
                                    <div style={styles.stockDescription}>{item.description}</div>
                                  ) : null}
                                </div>

                                <div style={styles.stockRowActions}>
                                  <button
                                    type="button"
                                    onClick={() => toggleActionMenu(item.id)}
                                    style={styles.actionMenuBtn}
                                  >
                                    Actions
                                  </button>

                                  {actionOpen ? (
                                    <div style={styles.actionMenu}>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActionMenuItemId(null);
                                          openMovementModal('RESTOCK', item);
                                        }}
                                        style={styles.actionMenuItem}
                                      >
                                        Restock
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActionMenuItemId(null);
                                          openMovementModal('TAKE_OUT', item);
                                        }}
                                        style={styles.actionMenuItem}
                                      >
                                        Stock Out
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActionMenuItemId(null);
                                          openMovementModal('TRANSFER', item);
                                        }}
                                        style={styles.actionMenuItem}
                                      >
                                        Move Branch
                                      </button>
                                      {isSuperuser ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActionMenuItemId(null);
                                            void handleDeleteItem(item);
                                          }}
                                          style={styles.actionMenuDelete}
                                          disabled={saving}
                                        >
                                          Delete
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionTitle}>Recent Stock Movements</div>

          {recentMovements.length === 0 ? (
            <div style={styles.emptyState}>No stock movements yet.</div>
          ) : (
            <div style={styles.logList}>
              {recentMovements.map((movement) => {
                const item = items.find((row) => row.id === movement.item_id);
                return (
                  <article key={movement.id} style={styles.logCard}>
                    <div style={styles.logHeader}>
                      <div style={styles.logTitle}>{item?.item_name || 'Item'}</div>
                      <div style={styles.logPill}>{movement.movement_type}</div>
                    </div>
                    <div style={styles.logMeta}>
                      Branch: {movement.branch_name} | Qty: {movement.qty}
                    </div>
                    {movement.reason ? <div style={styles.logMeta}>Reason: {movement.reason}</div> : null}
                    {movement.used_to ? <div style={styles.logMeta}>Used / moved to: {movement.used_to}</div> : null}
                    <div style={styles.logMeta}>
                      By: {movement.created_by_name || '-'} | {movement.created_at ? new Date(movement.created_at).toLocaleString() : '-'}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {modalOpen && activeItem ? (
          <div style={styles.modalOverlay} onClick={closeMovementModal}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalTitle}>
                {modalMode === 'RESTOCK'
                  ? 'Restock Item'
                  : modalMode === 'TAKE_OUT'
                  ? 'Stock Taken Out'
                  : 'Move Stock Between Branches'}
              </div>
              <div style={styles.modalItemName}>{activeItem.itemName}</div>

              <div style={styles.fieldWrap}>
                <label style={styles.label}>Current branch</label>
                <select
                  value={movementBranch}
                  onChange={(e) => setMovementBranch(e.target.value as BranchName)}
                  style={styles.input}
                  disabled={saving}
                >
                  {BRANCHES.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch} ({activeItem.branchStocks[branch]})
                    </option>
                  ))}
                </select>
              </div>

              {modalMode === 'TRANSFER' ? (
                <div style={styles.fieldWrap}>
                  <label style={styles.label}>Move to branch</label>
                  <select
                    value={targetBranch}
                    onChange={(e) => setTargetBranch(e.target.value as BranchName)}
                    style={styles.input}
                    disabled={saving}
                  >
                    {BRANCHES.filter((branch) => branch !== movementBranch).map((branch) => (
                      <option key={branch} value={branch}>{branch}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div style={styles.fieldWrap}>
                <label style={styles.label}>Quantity</label>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={movementQty}
                  onChange={(e) => setMovementQty(e.target.value)}
                  style={styles.input}
                  disabled={saving}
                />
              </div>

              <div style={styles.fieldWrap}>
                <label style={styles.label}>Reason</label>
                <input
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  placeholder={modalMode === 'RESTOCK' ? 'Restock note' : 'Why is this stock moving out?'}
                  style={styles.input}
                  disabled={saving}
                />
              </div>

              {modalMode !== 'RESTOCK' ? (
                <div style={styles.fieldWrap}>
                  <label style={styles.label}>{modalMode === 'TRANSFER' ? 'Moved to / note' : 'Used where'}</label>
                  <input
                    value={movementUsedTo}
                    onChange={(e) => setMovementUsedTo(e.target.value)}
                    placeholder={modalMode === 'TRANSFER' ? 'Target usage / note' : 'Where the stock was used'}
                    style={styles.input}
                    disabled={saving}
                  />
                </div>
              ) : null}

              {modalMode === 'TAKE_OUT' ? (
                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={reportDamage}
                    onChange={(e) => setReportDamage(e.target.checked)}
                    disabled={saving}
                  />
                  <span>
                    Report damage for the replaced item. Damaged quantity will match the stock taken out.
                  </span>
                </label>
              ) : null}

              <div style={styles.actionRow}>
                <button type="button" onClick={closeMovementModal} style={styles.secondaryGhostBtn} disabled={saving}>
                  Cancel
                </button>
                <button type="button" onClick={submitMovement} style={styles.primaryBtn} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f4f7fb',
    padding: '18px 14px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '1100px',
    margin: '0 auto',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '14px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '18px',
  },
  topBarActions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  pageTitle: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#0f172a',
  },
  pageSubTitle: {
    marginTop: '6px',
    color: '#64748b',
    fontSize: '14px',
    fontWeight: 600,
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #dfe7f2',
    borderRadius: '20px',
    padding: '16px',
    boxShadow: '0 12px 28px rgba(15,23,42,0.05)',
    marginBottom: '14px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '14px',
  },
  sectionHint: {
    marginTop: '-6px',
    marginBottom: '14px',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.45,
    fontWeight: 600,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  },
  input: {
    width: '100%',
    minWidth: 0,
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '14px',
    background: '#ffffff',
    boxSizing: 'border-box',
    outline: 'none',
  },
  primaryBtn: {
    border: 'none',
    background: '#2563eb',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
  },
  secondaryGhostBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  branchRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  branchPill: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '999px',
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  branchPillActive: {
    background: '#dbeafe',
    color: '#1d4ed8',
    borderColor: '#93c5fd',
  },
  categoryList: {
    display: 'grid',
    gap: '12px',
  },
  categorySection: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#ffffff',
    overflow: 'hidden',
  },
  categoryToggle: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    border: 'none',
    background: '#f8fbff',
    padding: '14px 16px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  categoryToggleLeft: {
    minWidth: 0,
  },
  categoryName: {
    fontSize: '17px',
    fontWeight: 800,
    color: '#0f172a',
  },
  categoryCount: {
    marginTop: '4px',
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 700,
  },
  categoryChevron: {
    fontSize: '12px',
    color: '#1d4ed8',
    fontWeight: 800,
    flexShrink: 0,
  },
  emptyStateCompact: {
    padding: '14px 16px 16px',
    color: '#64748b',
    fontSize: '13px',
    fontWeight: 600,
  },
  stockList: {
    display: 'grid',
    gap: '10px',
    padding: '0 12px 12px',
  },
  stockRow: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    border: '1px solid #e7edf5',
    borderRadius: '14px',
    background: '#ffffff',
    padding: '12px',
    flexWrap: 'wrap',
  },
  stockRowMain: {
    flex: 1,
    minWidth: 0,
  },
  stockRowTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  stockName: {
    fontSize: '15px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.35,
  },
  stockDescription: {
    marginTop: '6px',
    fontSize: '13px',
    color: '#64748b',
    lineHeight: 1.45,
  },
  stockBalanceWrap: {
    minWidth: '82px',
    borderRadius: '12px',
    background: '#eff6ff',
    border: '1px solid #dbeafe',
    padding: '8px 10px',
    textAlign: 'center',
    flexShrink: 0,
  },
  stockBalanceLabel: {
    fontSize: '11px',
    color: '#1d4ed8',
    fontWeight: 700,
  },
  stockBalanceValue: {
    marginTop: '4px',
    fontSize: '20px',
    color: '#0f172a',
    fontWeight: 900,
    lineHeight: 1,
  },
  stockRowActions: {
    position: 'relative',
    alignSelf: 'center',
  },
  actionMenuBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 800,
    cursor: 'pointer',
    minWidth: '96px',
  },
  actionMenu: {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 8px)',
    zIndex: 20,
    minWidth: '170px',
    background: '#ffffff',
    border: '1px solid #dfe7f2',
    borderRadius: '14px',
    boxShadow: '0 18px 34px rgba(15,23,42,0.12)',
    padding: '6px',
    display: 'grid',
    gap: '6px',
  },
  actionMenuItem: {
    border: 'none',
    background: '#f8fafc',
    color: '#0f172a',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'left',
  },
  actionMenuDelete: {
    border: 'none',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 800,
    cursor: 'pointer',
    textAlign: 'left',
  },
  actionRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '14px',
  },
  actionBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  deleteBtn: {
    border: '1px solid #ef4444',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  logList: {
    display: 'grid',
    gap: '10px',
  },
  logCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    background: '#ffffff',
    padding: '14px',
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  logTitle: {
    fontSize: '16px',
    color: '#0f172a',
    fontWeight: 800,
  },
  logPill: {
    borderRadius: '999px',
    padding: '6px 10px',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: '11px',
    fontWeight: 800,
  },
  logMeta: {
    marginTop: '6px',
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 600,
    lineHeight: 1.45,
  },
  fieldWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '12px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
  },
  checkboxRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    marginTop: '14px',
    color: '#475569',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    zIndex: 1000,
  },
  modalCard: {
    width: '100%',
    maxWidth: '520px',
    background: '#ffffff',
    borderRadius: '20px',
    border: '1px solid #dfe7f2',
    padding: '18px',
    boxShadow: '0 22px 48px rgba(15,23,42,0.18)',
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a',
  },
  modalItemName: {
    marginTop: '6px',
    color: '#64748b',
    fontSize: '14px',
    fontWeight: 600,
  },
  errorBox: {
    marginBottom: '14px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  successBox: {
    marginBottom: '14px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: 600,
  },
  emptyState: {
    border: '1px dashed #cbd5e1',
    background: '#f8fafc',
    borderRadius: '14px',
    padding: '24px',
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 600,
  },
  centerCard: {
    maxWidth: '460px',
    margin: '80px auto',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '24px',
    textAlign: 'center',
    boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
  },
  centerTitle: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '10px',
  },
  centerText: {
    fontSize: '15px',
    color: '#64748b',
    lineHeight: 1.5,
    marginBottom: '16px',
  },
  linkBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textDecoration: 'none',
    border: '1px solid #0f172a',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '12px 16px',
    fontWeight: 700,
  },
};
