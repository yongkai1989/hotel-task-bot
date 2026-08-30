'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import { loadDashboardSessionProfile } from '../../../lib/dashboardSessionProfileClient';

type DashboardRole = 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'FO' | 'HK' | 'MT';

type DashboardUser = {
  user_id?: string;
  email: string;
  name: string;
  role: DashboardRole;
  can_access_lost_found?: boolean;
};

type LostFoundEntry = {
  id: string;
  lost_date: string;
  room_number: string;
  item_description: string;
  location_stored: string;
  handled_by_name: string;
  sent_by_name?: string | null;
  received_by_name?: string | null;
  photo_url: string;
  photo_path?: string | null;
  returned: boolean;
  return_date?: string | null;
  return_method?: string | null;
  waybill_number?: string | null;
  postage_paid?: boolean | null;
  collector_name?: string | null;
  collector_ic?: string | null;
  returned_by_name?: string | null;
  disposed?: boolean;
  disposed_at?: string | null;
  disposed_by_name?: string | null;
  disposal_proof_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type LostFoundUpdate = {
  id: string;
  entry_id: string;
  previous_location: string;
  new_location: string;
  comment?: string | null;
  created_by_name: string;
  created_at: string;
};

type ReturnMethod = 'Courier' | 'Collected In Person';

const RETURN_METHODS: ReturnMethod[] = ['Courier', 'Collected In Person'];

function todayLocalDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const [yyyy, mm, dd] = value.split('-');
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function canUseLostFound(profile: DashboardUser | null) {
  if (!profile) return false;
  if (profile.role === 'SUPERUSER') return true;
  return profile.can_access_lost_found === true;
}

function statusBadge(entry: LostFoundEntry) {
  if (entry.disposed) return { label: 'Disposed', color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' };
  if (entry.returned) return { label: 'Returned', color: '#166534', bg: '#dcfce7', border: '#bbf7d0' };
  return { label: 'In Storage', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' };
}

async function imageToDataUrl(file: File) {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });

    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to process image');

    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.78);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function LostFoundPage() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [profile, setProfile] = useState<DashboardUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [entries, setEntries] = useState<LostFoundEntry[]>([]);
  const [entryUpdates, setEntryUpdates] = useState<LostFoundUpdate[]>([]);
  const [lostDate, setLostDate] = useState(todayLocalDate());
  const [roomNumber, setRoomNumber] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [locationStored, setLocationStored] = useState('');
  const [handledByName, setHandledByName] = useState('');
  const [sentByName, setSentByName] = useState('');
  const [receivedByName, setReceivedByName] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [returnEntry, setReturnEntry] = useState<LostFoundEntry | null>(null);
  const [returnDate, setReturnDate] = useState(todayLocalDate());
  const [returnMethod, setReturnMethod] = useState<ReturnMethod>('Collected In Person');
  const [waybillNumber, setWaybillNumber] = useState('');
  const [postagePaid, setPostagePaid] = useState(false);
  const [disposeEntry, setDisposeEntry] = useState<LostFoundEntry | null>(null);
  const [disposalProofFile, setDisposalProofFile] = useState<File | null>(null);
  const [updateEntry, setUpdateEntry] = useState<LostFoundEntry | null>(null);
  const [updatedLocation, setUpdatedLocation] = useState('');
  const [updateComment, setUpdateComment] = useState('');

  const activeEntries = entries.filter((entry) => !entry.returned && !entry.disposed);
  const returnedEntries = entries.filter((entry) => entry.returned && !entry.disposed);
  const disposedEntries = entries.filter((entry) => entry.disposed);
  const updatesByEntry = useMemo(() => {
    const grouped = new Map<string, LostFoundUpdate[]>();
    entryUpdates.forEach((update) => {
      const current = grouped.get(update.entry_id) || [];
      current.push(update);
      grouped.set(update.entry_id, current);
    });
    return grouped;
  }, [entryUpdates]);
  const isSuperuser = profile?.role === 'SUPERUSER';
  const canAccess = canUseLostFound(profile);

  useEffect(() => {
    void loadProfile();
  }, []);

  useEffect(() => {
    if (canAccess) {
      void loadEntries();
    }
  }, [canAccess]);

  useEffect(() => {
    if (profile?.name && !handledByName) {
      setHandledByName(profile.name);
    }
  }, [profile?.name, handledByName]);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || '';
  }

  async function loadProfile() {
    try {
      setAuthLoading(true);
      setErrorMsg('');

      const token = await getAccessToken();
      if (!token) {
        setProfile(null);
        return;
      }

      const nextProfile = await loadDashboardSessionProfile<DashboardUser>(token);
      setProfile(nextProfile);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load profile');
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadEntries() {
    try {
      setLoading(true);
      setErrorMsg('');

      const token = await getAccessToken();
      if (!token) throw new Error('Login required');

      const [entryResult, updateResponse] = await Promise.all([
        supabase
          .from('lost_found_entries')
          .select('*')
          .order('disposed', { ascending: true })
          .order('returned', { ascending: true })
          .order('lost_date', { ascending: false })
          .order('created_at', { ascending: false }),
        fetch('/api/lost-found/updates', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ]);

      if (entryResult.error) throw entryResult.error;
      const updateJson = await updateResponse.json();
      if (!updateResponse.ok || !updateJson?.ok) {
        throw new Error(updateJson?.error || 'Failed to load item updates');
      }

      setEntries((entryResult.data || []) as LostFoundEntry[]);
      setEntryUpdates((updateJson.updates || []) as LostFoundUpdate[]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load Lost & Found entries');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setLostDate(todayLocalDate());
    setRoomNumber('');
    setItemDescription('');
    setLocationStored('');
    setHandledByName(profile?.name || '');
    setSentByName('');
    setReceivedByName('');
    setPhotoFile(null);
    const input = document.getElementById('lost-found-photo') as HTMLInputElement | null;
    if (input) input.value = '';
  }

  async function uploadPhoto(file: File) {
    const token = await getAccessToken();
    if (!token) throw new Error('Login required');

    const image = await imageToDataUrl(file);
    const res = await fetch('/api/lost-found/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ image }),
    });

    const json = await res.json();
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'Photo upload failed');

    return {
      photo_url: String(json.url || ''),
      photo_path: String(json.path || ''),
    };
  }

  async function createEntry() {
    try {
      if (!profile?.user_id) throw new Error('Login required');
      if (!canAccess) throw new Error('You do not have access to Lost & Found');
      if (!lostDate) throw new Error('Date of Lost is required');
      if (!roomNumber.trim()) throw new Error('Room Number is required');
      if (!itemDescription.trim()) throw new Error('Item description is required');
      if (!locationStored.trim()) throw new Error('Location Stored is required');
      if (!sentByName.trim()) throw new Error('Staff who sent the item is required');
      if (!receivedByName.trim()) throw new Error('Staff who received the item is required');
      if (!photoFile) throw new Error('Photo upload is required');

      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const uploaded = await uploadPhoto(photoFile);
      const payload = {
        lost_date: lostDate,
        room_number: roomNumber.trim(),
        item_description: itemDescription.trim(),
        location_stored: locationStored.trim(),
        handled_by_name: receivedByName.trim(),
        sent_by_name: sentByName.trim(),
        received_by_name: receivedByName.trim(),
        photo_url: uploaded.photo_url,
        photo_path: uploaded.photo_path,
        returned: false,
        created_by_user_id: profile.user_id,
        created_by_name: profile.name || profile.email,
        updated_by_user_id: profile.user_id,
        updated_by_name: profile.name || profile.email,
      };

      const { error } = await supabase.from('lost_found_entries').insert([payload]);
      if (error) throw error;

      setSuccessMsg('Lost & Found entry created.');
      resetForm();
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create entry');
    } finally {
      setSaving(false);
    }
  }

  function openReturnModal(entry: LostFoundEntry) {
    setReturnEntry(entry);
    setReturnDate(todayLocalDate());
    setReturnMethod('Collected In Person');
    setWaybillNumber('');
    setPostagePaid(false);
    setErrorMsg('');
    setSuccessMsg('');
  }

  function closeReturnModal() {
    if (saving) return;
    setReturnEntry(null);
  }

  function openDisposeModal(entry: LostFoundEntry) {
    setDisposeEntry(entry);
    setDisposalProofFile(null);
    setErrorMsg('');
    setSuccessMsg('');
  }

  function closeDisposeModal() {
    if (saving) return;
    setDisposeEntry(null);
    setDisposalProofFile(null);
  }

  function openUpdateModal(entry: LostFoundEntry) {
    setUpdateEntry(entry);
    setUpdatedLocation(entry.location_stored || '');
    setUpdateComment('');
    setErrorMsg('');
    setSuccessMsg('');
  }

  function closeUpdateModal() {
    if (saving) return;
    setUpdateEntry(null);
    setUpdatedLocation('');
    setUpdateComment('');
  }

  async function saveItemUpdate() {
    try {
      if (!updateEntry) throw new Error('No item selected');
      if (!updatedLocation.trim()) throw new Error('Stored location is required');
      if (updatedLocation.trim() === updateEntry.location_stored.trim() && !updateComment.trim()) {
        throw new Error('Change the stored location or add a comment before saving');
      }

      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const token = await getAccessToken();
      if (!token) throw new Error('Login required');

      const response = await fetch('/api/lost-found/updates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entryId: updateEntry.id,
          locationStored: updatedLocation.trim(),
          comment: updateComment.trim(),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to update item');

      setUpdateEntry(null);
      setUpdatedLocation('');
      setUpdateComment('');
      setSuccessMsg('Item location and update history saved.');
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update item');
    } finally {
      setSaving(false);
    }
  }

  async function disposeItem() {
    try {
      if (!disposeEntry) throw new Error('No item selected');
      if (!disposalProofFile) throw new Error("Upload the guest's approval screenshot before disposing this item");

      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const token = await getAccessToken();
      if (!token) throw new Error('Login required');

      const image = await imageToDataUrl(disposalProofFile);
      const res = await fetch('/api/lost-found/dispose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ entryId: disposeEntry.id, image }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to dispose item');

      setDisposeEntry(null);
      setDisposalProofFile(null);
      setSuccessMsg('Item marked as disposed. Guest approval proof has been saved securely.');
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to dispose item');
    } finally {
      setSaving(false);
    }
  }

  async function viewDisposalProof(entry: LostFoundEntry) {
    const proofWindow = window.open('', '_blank');

    try {
      setErrorMsg('');
      const token = await getAccessToken();
      if (!token) throw new Error('Login required');

      const res = await fetch(`/api/lost-found/dispose?entryId=${encodeURIComponent(entry.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.ok || !json.url) throw new Error(json?.error || 'Failed to open disposal proof');

      if (proofWindow) {
        proofWindow.opener = null;
        proofWindow.location.href = String(json.url);
      } else {
        window.location.href = String(json.url);
      }
    } catch (err: any) {
      proofWindow?.close();
      setErrorMsg(err?.message || 'Failed to open disposal proof');
    }
  }

  async function markReturned() {
    try {
      if (!profile?.user_id) throw new Error('Login required');
      if (!returnEntry) throw new Error('No item selected');
      if (!returnDate) throw new Error('Date of return is required');

      if (returnMethod === 'Courier' && !waybillNumber.trim()) {
        throw new Error('Waybill Number is required for Courier return');
      }

      if (returnMethod === 'Courier' && !postagePaid) {
        throw new Error('Postage Paid must be ticked before saving a Courier return');
      }

      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('lost_found_entries')
        .update({
          returned: true,
          return_date: returnDate,
          return_method: returnMethod,
          waybill_number: returnMethod === 'Courier' ? waybillNumber.trim() : null,
          postage_paid: returnMethod === 'Courier' ? postagePaid : false,
          collector_name: null,
          collector_ic: null,
          returned_by_user_id: profile.user_id,
          returned_by_name: profile.name || profile.email,
          updated_by_user_id: profile.user_id,
          updated_by_name: profile.name || profile.email,
        })
        .eq('id', returnEntry.id);

      if (error) throw error;

      setSuccessMsg('Item marked as returned.');
      setReturnEntry(null);
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to mark returned');
    } finally {
      setSaving(false);
    }
  }

  async function reverseReturned(entry: LostFoundEntry) {
    if (!profile?.user_id) {
      setErrorMsg('Login required');
      return;
    }

    const ok = window.confirm(
      `Move "${entry.item_description}" back into storage? This will clear the return date, method, and waybill.`
    );

    if (!ok) return;

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('lost_found_entries')
        .update({
          returned: false,
          return_date: null,
          return_method: null,
          waybill_number: null,
          postage_paid: false,
          collector_name: null,
          collector_ic: null,
          returned_by_user_id: null,
          returned_by_name: null,
          updated_by_user_id: profile.user_id,
          updated_by_name: profile.name || profile.email,
        })
        .eq('id', entry.id);

      if (error) throw error;

      setSuccessMsg('Return reversed. Item is back in storage.');
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to reverse return');
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry: LostFoundEntry) {
    if (!isSuperuser) return;
    const ok = window.confirm(`Delete Lost & Found entry for ${entry.item_description}?`);
    if (!ok) return;

    try {
      setSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase.from('lost_found_entries').delete().eq('id', entry.id);
      if (error) throw error;

      setSuccessMsg('Entry deleted.');
      await loadEntries();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete entry');
    } finally {
      setSaving(false);
    }
  }

  function printCollectionForm(entry: LostFoundEntry, selectedReturnDate?: string | null) {
    const displayReturnDate = selectedReturnDate || entry.return_date || todayLocalDate();
    const logoUrl = `${window.location.origin}/logo.png`;
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Lost & Found Acknowledgement</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0f172a; padding: 32px; }
            .header { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
            .logo { width: 58px; height: 58px; object-fit: contain; }
            h1 { font-size: 24px; margin: 0 0 6px; }
            .sub { color: #475569; margin-bottom: 24px; }
            .box { border: 1px solid #cbd5e1; border-radius: 12px; padding: 18px; margin-bottom: 18px; }
            .row { display: grid; grid-template-columns: 180px 1fr; gap: 10px; padding: 7px 0; border-bottom: 1px solid #e2e8f0; }
            .row:last-child { border-bottom: none; }
            .label { font-weight: 700; color: #334155; }
            .fill { min-height: 28px; border-bottom: 1px solid #0f172a; }
            .notice { margin: 18px 0; font-size: 13px; line-height: 1.6; color: #334155; }
            .sig { margin-top: 60px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
            .line { border-top: 1px solid #0f172a; padding-top: 8px; }
            @media print { body { padding: 22px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <img class="logo" src="${escapeHtml(logoUrl)}" alt="Hallmark Crown Hotel logo" />
            <div>
              <h1>Hallmark Crown Hotel</h1>
              <div class="sub">Lost & Found Item Collection Acknowledgement</div>
            </div>
          </div>
          <div class="box">
            <div class="row"><div class="label">Date of Lost</div><div>${escapeHtml(formatDate(entry.lost_date))}</div></div>
            <div class="row"><div class="label">Room Number</div><div>${escapeHtml(entry.room_number)}</div></div>
            <div class="row"><div class="label">Item Description</div><div>${escapeHtml(entry.item_description)}</div></div>
            <div class="row"><div class="label">Date of Return</div><div>${escapeHtml(formatDate(displayReturnDate))}</div></div>
            <div class="row"><div class="label">Method of Return</div><div>Collected In Person</div></div>
          </div>
          <div class="notice">
            I acknowledge that I have collected the item listed above from Hallmark Crown Hotel in good order.
          </div>
          <div class="box">
            <div class="row"><div class="label">Collector Name</div><div class="fill"></div></div>
            <div class="row"><div class="label">IC / Passport No.</div><div class="fill"></div></div>
            <div class="row"><div class="label">Contact Number</div><div class="fill"></div></div>
          </div>
          <div class="sig">
            <div class="line">Collector Signature</div>
            <div class="line">Staff Signature</div>
          </div>
          <script>window.print();</script>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  function renderEntry(entry: LostFoundEntry) {
    const badge = statusBadge(entry);
    const updates = updatesByEntry.get(entry.id) || [];

    return (
      <article key={entry.id} style={styles.entryCard}>
        <a href={entry.photo_url} target="_blank" rel="noreferrer" style={styles.photoWrap}>
          <img src={entry.photo_url} alt={entry.item_description} style={styles.photo} />
        </a>

        <div style={styles.entryBody}>
          <div style={styles.entryTop}>
            <div>
              <div style={styles.entryTitle}>{entry.item_description}</div>
              <div style={styles.entryMeta}>Room {entry.room_number} | Lost {formatDate(entry.lost_date)}</div>
            </div>
            <span style={{ ...styles.badge, color: badge.color, background: badge.bg, borderColor: badge.border }}>
              {badge.label}
            </span>
          </div>

          <div style={styles.detailGrid}>
            <div><b>Stored:</b> {entry.location_stored}</div>
            <div><b>Sent By:</b> {entry.sent_by_name || '-'}</div>
            <div><b>Received By:</b> {entry.received_by_name || entry.handled_by_name}</div>
            <div><b>Created:</b> {formatDateTime(entry.created_at)}</div>
            {entry.returned ? <div><b>Returned:</b> {formatDate(entry.return_date)}</div> : null}
            {entry.return_method ? <div><b>Method:</b> {entry.return_method}</div> : null}
            {entry.waybill_number ? <div><b>Waybill:</b> {entry.waybill_number}</div> : null}
            {entry.return_method === 'Courier' ? <div><b>Postage Paid:</b> {entry.postage_paid ? 'Yes' : 'No'}</div> : null}
            {entry.collector_name ? <div><b>Collector:</b> {entry.collector_name}</div> : null}
            {entry.collector_ic ? <div><b>IC:</b> {entry.collector_ic}</div> : null}
            {entry.disposed ? <div><b>Disposed:</b> {formatDateTime(entry.disposed_at)}</div> : null}
            {entry.disposed_by_name ? <div><b>Disposed By:</b> {entry.disposed_by_name}</div> : null}
          </div>

          {updates.length > 0 ? (
            <div style={styles.updateHistory}>
              <div style={styles.updateHistoryTitle}>Item Updates</div>
              <div style={styles.updateHistoryList}>
                {updates.map((update) => (
                  <div key={update.id} style={styles.updateHistoryRow}>
                    <div style={styles.updateHistoryMeta}>
                      {update.created_by_name} | {formatDateTime(update.created_at)}
                    </div>
                    {update.previous_location !== update.new_location ? (
                      <div style={styles.locationChange}>
                        Location: {update.previous_location} → {update.new_location}
                      </div>
                    ) : null}
                    {update.comment ? <div style={styles.updateComment}>{update.comment}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div style={styles.cardActions}>
            {!entry.returned && !entry.disposed ? (
              <button type="button" onClick={() => openUpdateModal(entry)} disabled={saving} style={styles.updateSmall}>
                Update Item
              </button>
            ) : null}

            {!entry.returned && !entry.disposed ? (
              <button type="button" onClick={() => openReturnModal(entry)} disabled={saving} style={styles.primarySmall}>
                Mark Returned
              </button>
            ) : null}

            {!entry.returned && !entry.disposed ? (
              <button type="button" onClick={() => openDisposeModal(entry)} disabled={saving} style={styles.disposeSmall}>
                Dispose
              </button>
            ) : null}

            {entry.returned && entry.return_method === 'Collected In Person' ? (
              <button type="button" onClick={() => printCollectionForm(entry)} style={styles.secondarySmall}>
                Print Collection Form
              </button>
            ) : null}

            {entry.returned ? (
              <button type="button" onClick={() => void reverseReturned(entry)} disabled={saving} style={styles.warningSmall}>
                Reverse Return
              </button>
            ) : null}

            {entry.disposed && entry.disposal_proof_path ? (
              <button type="button" onClick={() => void viewDisposalProof(entry)} style={styles.secondarySmall}>
                View Guest Approval
              </button>
            ) : null}

            {isSuperuser ? (
              <button type="button" onClick={() => void deleteEntry(entry)} disabled={saving} style={styles.deleteSmall}>
                Delete
              </button>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  if (authLoading) {
    return <main style={styles.page}><div style={styles.centerCard}>Loading...</div></main>;
  }

  if (!profile) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Login required</div>
          <p style={styles.centerText}>Please log in first, then open Lost & Found again.</p>
          <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  if (!canAccess) {
    return (
      <main style={styles.page}>
        <div style={styles.centerCard}>
          <div style={styles.centerTitle}>Access blocked</div>
          <p style={styles.centerText}>Lost & Found is only available to FO users with access and superusers.</p>
          <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.hero}>
          <div>
            <div style={styles.kicker}>Front Office</div>
            <h1 style={styles.title}>Lost & Found</h1>
            <p style={styles.subtitle}>Create, track, return, and acknowledge guest lost items.</p>
          </div>
          <Link href="/dashboard" style={styles.secondaryBtn}>Dashboard</Link>
        </header>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <section style={styles.panel}>
          <div style={styles.panelTitle}>Create Entry</div>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Date of Lost</label>
              <input type="date" value={lostDate} onChange={(e) => setLostDate(e.target.value)} style={styles.dateInput} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Room Number</label>
              <input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="e.g. 1205" style={styles.input} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Location Stored</label>
              <input value={locationStored} onChange={(e) => setLocationStored(e.target.value)} placeholder="e.g. FO cabinet" style={styles.input} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Sent By Staff</label>
              <input value={sentByName} onChange={(e) => setSentByName(e.target.value)} placeholder="Staff who sent item" style={styles.input} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Received By Staff</label>
              <input value={receivedByName} onChange={(e) => setReceivedByName(e.target.value)} placeholder="Staff who received item" style={styles.input} />
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Item Description</label>
            <textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} placeholder="Describe the item clearly" style={styles.textarea} />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Photo Upload</label>
            <input
              id="lost-found-photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              style={styles.fileInput}
            />
            <div style={styles.helper}>Photo is compulsory. The app compresses it before upload.</div>
          </div>

          <div style={styles.actions}>
            <button type="button" onClick={() => void createEntry()} disabled={saving} style={{ ...styles.primaryBtn, opacity: saving ? 0.65 : 1 }}>
              {saving ? 'Saving...' : 'Create Lost Item'}
            </button>
            <button type="button" onClick={resetForm} disabled={saving} style={styles.secondaryBtn}>
              Clear
            </button>
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.sectionHead}>
            <div>
              <div style={styles.panelTitle}>Items In Storage</div>
              <div style={styles.helper}>{activeEntries.length} active item{activeEntries.length === 1 ? '' : 's'}</div>
            </div>
            <button type="button" onClick={() => void loadEntries()} style={styles.secondaryBtn}>Refresh</button>
          </div>

          {loading ? <div style={styles.empty}>Loading entries...</div> : null}
          {!loading && activeEntries.length === 0 ? <div style={styles.empty}>No active Lost & Found items.</div> : null}
          <div style={styles.list}>{activeEntries.map(renderEntry)}</div>
        </section>

        <section style={styles.panel}>
          <div style={styles.panelTitle}>Returned Items</div>
          {!loading && returnedEntries.length === 0 ? <div style={styles.empty}>No returned items yet.</div> : null}
          <div style={styles.list}>{returnedEntries.map(renderEntry)}</div>
        </section>

        <section style={styles.panel}>
          <div style={styles.panelTitle}>Disposed Items</div>
          <div style={styles.helper}>Disposal records retain the staff member, date, time, and guest-approval proof.</div>
          {!loading && disposedEntries.length === 0 ? <div style={styles.empty}>No disposed items yet.</div> : null}
          <div style={styles.list}>{disposedEntries.map(renderEntry)}</div>
        </section>
      </div>

      {returnEntry ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHead}>
              <div>
                <div style={styles.panelTitle}>Return Item</div>
                <div style={styles.helper}>{returnEntry.item_description} | Room {returnEntry.room_number}</div>
              </div>
              <button type="button" onClick={closeReturnModal} style={styles.iconBtn}>x</button>
            </div>

            <div style={styles.formGrid}>
              <div style={styles.field}>
                <label style={styles.label}>Date of Return</label>
                <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} style={styles.dateInput} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Method of Return</label>
                <select value={returnMethod} onChange={(e) => setReturnMethod(e.target.value as ReturnMethod)} style={styles.input}>
                  {RETURN_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
              </div>
            </div>

            {returnMethod === 'Courier' ? (
              <div>
                <div style={styles.field}>
                  <label style={styles.label}>Waybill Number</label>
                  <input value={waybillNumber} onChange={(e) => setWaybillNumber(e.target.value)} placeholder="Required for courier" style={styles.input} />
                </div>
                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={postagePaid}
                    onChange={(e) => setPostagePaid(e.target.checked)}
                    style={styles.checkbox}
                  />
                  <span>
                    <span style={styles.checkboxTitle}>Postage Paid</span>
                    <span style={styles.checkboxHelper}>Courier returns can only be saved after postage is paid.</span>
                  </span>
                </label>
              </div>
            ) : (
              <div style={styles.printPrompt}>
                <div>
                  <div style={styles.printPromptTitle}>Customer fills acknowledgement on paper</div>
                  <div style={styles.helper}>Print this form, let the customer fill in Name, IC, contact number, and signature, then file the signed copy.</div>
                </div>
                <button type="button" onClick={() => printCollectionForm(returnEntry, returnDate)} style={styles.secondaryBtn}>
                  Print Collection Form
                </button>
              </div>
            )}

            <div style={styles.actions}>
              <button
                type="button"
                onClick={() => void markReturned()}
                disabled={saving || (returnMethod === 'Courier' && (!waybillNumber.trim() || !postagePaid))}
                style={{
                  ...styles.primaryBtn,
                  opacity: saving || (returnMethod === 'Courier' && (!waybillNumber.trim() || !postagePaid)) ? 0.55 : 1,
                  cursor: saving || (returnMethod === 'Courier' && (!waybillNumber.trim() || !postagePaid)) ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Return'}
              </button>
              <button type="button" onClick={closeReturnModal} disabled={saving} style={styles.secondaryBtn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {updateEntry ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHead}>
              <div>
                <div style={styles.panelTitle}>Update Stored Item</div>
                <div style={styles.helper}>{updateEntry.item_description} | Room {updateEntry.room_number}</div>
              </div>
              <button type="button" onClick={closeUpdateModal} style={styles.iconBtn}>x</button>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Current Stored Location</label>
              <input
                value={updatedLocation}
                onChange={(e) => setUpdatedLocation(e.target.value)}
                placeholder="e.g. FO cabinet"
                maxLength={200}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Update Comment (Optional)</label>
              <textarea
                value={updateComment}
                onChange={(e) => setUpdateComment(e.target.value)}
                placeholder="e.g. Guest will collect during the next visit"
                maxLength={1000}
                style={styles.textarea}
              />
              <div style={styles.helper}>
                Add follow-up information such as who may collect the item. Every comment keeps the staff name, date, and time.
              </div>
            </div>

            <div style={styles.actions}>
              <button
                type="button"
                onClick={() => void saveItemUpdate()}
                disabled={saving || !updatedLocation.trim()}
                style={{
                  ...styles.primaryBtn,
                  opacity: saving || !updatedLocation.trim() ? 0.55 : 1,
                  cursor: saving || !updatedLocation.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Update'}
              </button>
              <button type="button" onClick={closeUpdateModal} disabled={saving} style={styles.secondaryBtn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {disposeEntry ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHead}>
              <div>
                <div style={styles.panelTitle}>Dispose Lost Item</div>
                <div style={styles.helper}>{disposeEntry.item_description} | Room {disposeEntry.room_number}</div>
              </div>
              <button type="button" onClick={closeDisposeModal} style={styles.iconBtn}>x</button>
            </div>

            <div style={styles.disposeWarning}>
              Disposal can only be submitted after proof of the guest's approval is uploaded. The proof and disposal details will remain in history.
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Guest Approval Screenshot (Required)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setDisposalProofFile(e.target.files?.[0] || null)}
                style={styles.fileInput}
              />
              <div style={styles.helper}>
                Upload a clear screenshot showing that the guest agreed to dispose of this item.
              </div>
            </div>

            <div style={styles.actions}>
              <button
                type="button"
                onClick={() => void disposeItem()}
                disabled={saving || !disposalProofFile}
                style={{
                  ...styles.disposeBtn,
                  opacity: saving || !disposalProofFile ? 0.5 : 1,
                  cursor: saving || !disposalProofFile ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Confirm Dispose'}
              </button>
              <button type="button" onClick={closeDisposeModal} disabled={saving} style={styles.secondaryBtn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f4f7fb', padding: '18px 14px 44px', color: '#0f172a' },
  shell: { maxWidth: 1220, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 },
  hero: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', background: '#ffffff', border: '1px solid #dbe5f2', borderRadius: 22, padding: '18px 20px', boxShadow: '0 18px 42px rgba(15, 23, 42, 0.07)' },
  kicker: { fontSize: 12, fontWeight: 900, letterSpacing: 0, color: '#2563eb', textTransform: 'uppercase' },
  title: { margin: 0, fontSize: 30, lineHeight: 1.1, fontWeight: 900, letterSpacing: 0 },
  subtitle: { margin: '6px 0 0', color: '#64748b', fontSize: 14, lineHeight: 1.5 },
  panel: { background: '#ffffff', border: '1px solid #dbe5f2', borderRadius: 22, padding: 18, boxShadow: '0 16px 36px rgba(15, 23, 42, 0.055)' },
  panelTitle: { fontSize: 20, fontWeight: 900, color: '#0f172a', marginBottom: 10 },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12, minWidth: 0 },
  label: { fontSize: 12, fontWeight: 900, color: '#334155' },
  input: { width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 14, padding: '12px 13px', color: '#0f172a', fontSize: 15, outline: 'none', background: '#ffffff' },
  checkboxRow: { display: 'flex', alignItems: 'flex-start', gap: 10, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 16, padding: 13, marginBottom: 12, cursor: 'pointer' },
  checkbox: { width: 18, height: 18, marginTop: 2, accentColor: '#2563eb', flex: '0 0 auto' },
  checkboxTitle: { display: 'block', fontSize: 14, fontWeight: 900, color: '#0f172a', lineHeight: 1.25 },
  checkboxHelper: { display: 'block', marginTop: 3, fontSize: 12, fontWeight: 700, color: '#475569', lineHeight: 1.35 },
  dateInput: { width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 14, padding: '10px 10px', color: '#0f172a', fontSize: 14, outline: 'none', background: '#ffffff', WebkitAppearance: 'none' },
  textarea: { width: '100%', minHeight: 92, boxSizing: 'border-box', resize: 'vertical', border: '1px solid #cbd5e1', borderRadius: 14, padding: '12px 13px', color: '#0f172a', fontSize: 15, outline: 'none', background: '#ffffff' },
  fileInput: { width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 14, padding: 11, background: '#f8fafc', color: '#0f172a' },
  helper: { color: '#64748b', fontSize: 13, lineHeight: 1.45, fontWeight: 700 },
  actions: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 },
  primaryBtn: { border: 'none', background: '#2563eb', color: '#ffffff', borderRadius: 14, padding: '12px 16px', fontWeight: 900, cursor: 'pointer', boxShadow: '0 10px 24px rgba(37, 99, 235, 0.2)' },
  secondaryBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: 14, padding: '11px 14px', fontWeight: 900, cursor: 'pointer' },
  primarySmall: { border: 'none', background: '#2563eb', color: '#ffffff', borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' },
  secondarySmall: { border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' },
  updateSmall: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' },
  warningSmall: { border: '1px solid #fed7aa', background: '#fff7ed', color: '#c2410c', borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' },
  disposeSmall: { border: '1px solid #fecdd3', background: '#fff1f2', color: '#be123c', borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' },
  disposeBtn: { border: 'none', background: '#be123c', color: '#ffffff', borderRadius: 14, padding: '12px 16px', fontWeight: 900, boxShadow: '0 10px 24px rgba(190, 18, 60, 0.2)' },
  disposeWarning: { border: '1px solid #fecdd3', background: '#fff1f2', color: '#9f1239', borderRadius: 16, padding: 14, marginBottom: 14, fontSize: 13, lineHeight: 1.5, fontWeight: 800 },
  deleteSmall: { border: '1px solid #fecaca', background: '#fff1f2', color: '#b91c1c', borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' },
  errorBox: { border: '1px solid #fecaca', background: '#fff1f2', color: '#b91c1c', borderRadius: 16, padding: '12px 14px', fontWeight: 900 },
  successBox: { border: '1px solid #bbf7d0', background: '#ecfdf5', color: '#166534', borderRadius: 16, padding: '12px 14px', fontWeight: 900 },
  list: { display: 'grid', gap: 10, marginTop: 12 },
  entryCard: { display: 'grid', gridTemplateColumns: '116px 1fr', gap: 14, border: '1px solid #e2e8f0', borderRadius: 18, padding: 12, background: '#fbfdff' },
  photoWrap: { width: 116, height: 102, borderRadius: 14, overflow: 'hidden', border: '1px solid #dbe5f2', background: '#f1f5f9' },
  photo: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  entryBody: { minWidth: 0 },
  entryTop: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  entryTitle: { fontSize: 17, fontWeight: 900, color: '#0f172a', overflowWrap: 'anywhere' },
  entryMeta: { color: '#64748b', fontSize: 13, marginTop: 3, fontWeight: 700 },
  badge: { border: '1px solid', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, color: '#475569', fontSize: 13, lineHeight: 1.35 },
  updateHistory: { marginTop: 12, border: '1px solid #dbeafe', background: '#f8fbff', borderRadius: 14, padding: 11 },
  updateHistoryTitle: { color: '#1e3a8a', fontSize: 12, fontWeight: 900, marginBottom: 7, textTransform: 'uppercase' },
  updateHistoryList: { display: 'grid', gap: 7, maxHeight: 190, overflowY: 'auto' },
  updateHistoryRow: { borderTop: '1px solid #dbeafe', paddingTop: 7 },
  updateHistoryMeta: { color: '#64748b', fontSize: 11, fontWeight: 800, marginBottom: 3 },
  locationChange: { color: '#1e40af', fontSize: 13, fontWeight: 800, overflowWrap: 'anywhere' },
  updateComment: { color: '#334155', fontSize: 13, lineHeight: 1.45, marginTop: 3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  cardActions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  empty: { border: '1px dashed #cbd5e1', borderRadius: 16, padding: 22, textAlign: 'center', color: '#64748b', fontWeight: 900, background: '#f8fafc' },
  modalOverlay: { position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 },
  modal: { width: '100%', maxWidth: 'min(620px, calc(100vw - 28px))', boxSizing: 'border-box', background: '#ffffff', borderRadius: 22, border: '1px solid #dbe5f2', padding: 16, boxShadow: '0 24px 70px rgba(15, 23, 42, 0.24)', overflowX: 'hidden' },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', fontWeight: 900, cursor: 'pointer' },
  printPrompt: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 16, padding: 14, marginBottom: 12 },
  printPromptTitle: { fontSize: 14, fontWeight: 900, color: '#1e3a8a', marginBottom: 4 },
  centerCard: { maxWidth: 520, margin: '80px auto', background: '#ffffff', border: '1px solid #dbe5f2', borderRadius: 22, padding: 24, textAlign: 'center', boxShadow: '0 16px 36px rgba(15, 23, 42, 0.08)' },
  centerTitle: { fontSize: 22, fontWeight: 900, marginBottom: 8 },
  centerText: { color: '#64748b', lineHeight: 1.5 },
};
