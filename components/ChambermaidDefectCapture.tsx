'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createBrowserSupabaseClient } from '../lib/supabaseBrowser';

type CapturedMedia = {
  id: string;
  file: File;
  previewUrl: string;
  kind: 'image' | 'video';
};

type Props = {
  roomNumber: string;
  serviceDate: string;
  onSubmitted?: (mediaCount: number, warning?: string) => void;
};

const MAX_MEDIA = 30;
const DEFECT_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  border: 0,
  borderRadius: 11,
  background: '#dc2626',
  color: '#fff',
  padding: '10px 12px',
  fontSize: 13,
  fontWeight: 900,
  boxShadow: '0 6px 14px rgba(220,38,38,.25)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function mediaRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) || '';
}

function makeMediaItem(file: File): CapturedMedia {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    kind: file.type.startsWith('video/') ? 'video' : 'image',
  };
}

export default function ChambermaidDefectCapture({ roomNumber, serviceDate, onSubmitted }: Props) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<CapturedMedia[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const mediaRef = useRef<CapturedMedia[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function releaseCamera(updateState = true) {
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    recordedChunksRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (updateState) {
      setCameraReady(false);
      setRecording(false);
    }
  }

  function discardMedia(items: CapturedMedia[]) {
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    return () => {
      releaseCamera(false);
      discardMedia(mediaRef.current);
    };
  }, []);

  async function openCamera() {
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Live camera is not supported on this device. Use Camera / Gallery instead.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setOpen(true);
      setCameraReady(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      });
    } catch (cameraError: any) {
      setOpen(true);
      setCameraReady(false);
      setError(cameraError?.message || 'Camera permission was not granted. Use Camera / Gallery instead.');
    }
  }

  function closeCapture() {
    if (submitting) return;
    releaseCamera();
    discardMedia(media);
    setMedia([]);
    setError('');
    setOpen(false);
  }

  async function takePhoto() {
    if (!videoRef.current || !cameraReady || recording || media.length >= MAX_MEDIA) return;
    const video = videoRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setError('Camera is still starting. Try again in a moment.');
      return;
    }

    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1920 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) {
      setError('Unable to capture photo. Please try again.');
      return;
    }

    const file = new File([blob], `room-${roomNumber}-${Date.now()}.jpg`, { type: 'image/jpeg' });
    setMedia((current) => [...current, makeMediaItem(file)]);
    setError('');
  }

  function startVideo() {
    if (!streamRef.current || recording || media.length >= MAX_MEDIA) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('Video recording is not supported on this device. Use Camera / Gallery instead.');
      return;
    }

    try {
      const mimeType = mediaRecorderMimeType();
      const recorder = new MediaRecorder(
        streamRef.current,
        mimeType ? { mimeType, videoBitsPerSecond: 1_000_000 } : { videoBitsPerSecond: 1_000_000 }
      );
      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        if (!chunks.length) return;
        const type = recorder.mimeType || mimeType || 'video/webm';
        const extension = type.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type });
        const file = new File([blob], `room-${roomNumber}-${Date.now()}.${extension}`, { type });
        setMedia((current) => current.length >= MAX_MEDIA ? current : [...current, makeMediaItem(file)]);
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      recordingTimeoutRef.current = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
        recorderRef.current = null;
        recordingTimeoutRef.current = null;
        setRecording(false);
      }, 45_000);
      setRecording(true);
      setError('');
    } catch (recordingError: any) {
      setError(recordingError?.message || 'Unable to start video recording.');
    }
  }

  function stopVideo() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    recorder.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  function addFallbackFiles(files: File[]) {
    const supported = files.filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'));
    const valid = supported.filter((file) =>
      file.type.startsWith('video/') ? file.size <= 12 * 1024 * 1024 : file.size <= 8 * 1024 * 1024
    );
    if (valid.length !== files.length) {
      setError('Some files were skipped. Photos must be 8 MB or smaller and videos 12 MB or smaller.');
    }
    if (!valid.length) return;
    setMedia((current) => {
      const available = Math.max(0, MAX_MEDIA - current.length);
      return [...current, ...valid.slice(0, available).map(makeMediaItem)];
    });
    if (valid.length === files.length) setError('');
    if (fallbackInputRef.current) fallbackInputRef.current.value = '';
  }

  function removeMedia(id: string) {
    setMedia((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function submitDefect() {
    if (!media.length || submitting || recording) return;
    if (media.reduce((total, item) => total + item.file.size, 0) > 60 * 1024 * 1024) {
      setError('Combined photos and videos must be 60 MB or smaller. Remove one or more clips.');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw sessionError || new Error('Please log in again.');

      const form = new FormData();
      form.set('room', roomNumber);
      form.set('service_date', serviceDate);
      media.forEach((item) => form.append('media', item.file, item.file.name));

      const response = await fetch('/api/chambermaid-defects', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Unable to submit defect.');

      const submittedCount = media.length;
      releaseCamera();
      discardMedia(media);
      setMedia([]);
      setOpen(false);
      onSubmitted?.(submittedCount, String(payload?.warning || '').trim() || undefined);
    } catch (submitError: any) {
      setError(submitError?.message || 'Unable to submit defect.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" style={DEFECT_BUTTON_STYLE} onClick={() => void openCamera()}>
        <span aria-hidden="true">📷</span>
        Report Defect
      </button>

      {open ? (
        <div className="maid-camera-overlay" role="dialog" aria-modal="true" aria-label={`Report defect for room ${roomNumber}`}>
          <div className="maid-camera-panel">
            <header>
              <div><small>MAINTENANCE DEFECT</small><h2>Room {roomNumber}</h2></div>
              <button type="button" onClick={closeCapture} disabled={submitting} aria-label="Close camera">×</button>
            </header>

            <div className="maid-camera-view">
              <video ref={videoRef} muted playsInline autoPlay />
              {!cameraReady ? <div className="maid-camera-fallback">Camera unavailable<br /><span>Use Camera / Gallery below</span></div> : null}
              {recording ? <div className="maid-recording-badge"><i /> Recording</div> : null}
              <div className="maid-capture-count">{media.length}/{MAX_MEDIA}</div>
            </div>

            {error ? <div className="maid-camera-error">{error}</div> : null}

            <div className="maid-camera-actions">
              <button type="button" className="maid-photo-action" onClick={() => void takePhoto()} disabled={!cameraReady || recording || submitting || media.length >= MAX_MEDIA}>Take Photo</button>
              {recording ? (
                <button type="button" className="maid-stop-action" onClick={stopVideo}>Stop Video</button>
              ) : (
                <button type="button" className="maid-video-action" onClick={startVideo} disabled={!cameraReady || submitting || media.length >= MAX_MEDIA}>Record Video</button>
              )}
              <input ref={fallbackInputRef} type="file" accept="image/*,video/*" capture="environment" multiple hidden onChange={(event) => addFallbackFiles(Array.from(event.target.files || []))} />
              <button type="button" className="maid-gallery-action" onClick={() => fallbackInputRef.current?.click()} disabled={submitting || media.length >= MAX_MEDIA}>Camera / Gallery</button>
            </div>

            {media.length ? (
              <div className="maid-media-strip">
                {media.map((item, index) => (
                  <div className="maid-media-thumb" key={item.id}>
                    {item.kind === 'video' ? <video src={item.previewUrl} muted playsInline /> : <img src={item.previewUrl} alt={`Capture ${index + 1}`} />}
                    <span>{item.kind === 'video' ? 'VIDEO' : index + 1}</span>
                    <button type="button" onClick={() => removeMedia(item.id)} disabled={submitting} aria-label={`Remove capture ${index + 1}`}>×</button>
                  </div>
                ))}
              </div>
            ) : <p className="maid-camera-hint">Keep taking photos or videos. The camera stays open until you submit.</p>}

            <footer>
              <button type="button" className="maid-cancel-action" onClick={closeCapture} disabled={submitting}>Cancel</button>
              <button type="button" className="maid-submit-action" onClick={() => void submitDefect()} disabled={!media.length || recording || submitting}>
                {submitting ? 'Uploading & Sending...' : `Submit to Maintenance${media.length ? ` (${media.length})` : ''}`}
              </button>
            </footer>
          </div>

          <style>{`
            .maid-camera-overlay{position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.94);display:flex;align-items:stretch;justify-content:center;padding:0}
            .maid-camera-panel{width:min(100%,720px);height:100%;background:#07111f;color:#fff;display:flex;flex-direction:column;overflow:auto}
            .maid-camera-panel>header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:#0f172a;position:sticky;top:0;z-index:2}
            .maid-camera-panel>header small{display:block;color:#fbbf24;font-size:11px;font-weight:900;letter-spacing:.08em}.maid-camera-panel>header h2{margin:2px 0 0;font-size:24px}.maid-camera-panel>header button{width:44px;height:44px;border-radius:50%;border:1px solid #475569;background:#1e293b;color:#fff;font-size:28px}
            .maid-camera-view{position:relative;min-height:48vh;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
            .maid-camera-view video{width:100%;height:100%;min-height:48vh;object-fit:cover}
            .maid-camera-fallback{position:absolute;text-align:center;font-size:20px;font-weight:900;color:#cbd5e1}.maid-camera-fallback span{font-size:14px;font-weight:600}
            .maid-recording-badge,.maid-capture-count{position:absolute;top:14px;border-radius:999px;padding:8px 12px;font-weight:900;background:rgba(15,23,42,.8)}
            .maid-recording-badge{left:14px;color:#fecaca}.maid-recording-badge i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;margin-right:6px}.maid-capture-count{right:14px}
            .maid-camera-error{margin:10px 12px 0;padding:10px 12px;border:1px solid #f87171;background:#451a1a;border-radius:10px;color:#fecaca;font-weight:700}
            .maid-camera-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px}.maid-camera-actions button{min-height:58px;border:0;border-radius:12px;color:#fff;font-weight:900;font-size:15px}.maid-photo-action{background:#2563eb}.maid-video-action{background:#7c3aed}.maid-stop-action{background:#dc2626}.maid-gallery-action{background:#334155}.maid-camera-actions button:disabled,.maid-camera-panel>footer button:disabled{opacity:.45}
            .maid-media-strip{display:flex;gap:8px;overflow-x:auto;padding:0 12px 10px}.maid-media-thumb{position:relative;flex:0 0 82px;height:82px;border:2px solid #334155;border-radius:10px;overflow:hidden;background:#000}.maid-media-thumb img,.maid-media-thumb video{width:100%;height:100%;object-fit:cover}.maid-media-thumb span{position:absolute;left:4px;bottom:4px;background:rgba(0,0,0,.75);padding:2px 5px;border-radius:5px;font-size:9px;font-weight:900}.maid-media-thumb button{position:absolute;right:3px;top:3px;width:25px;height:25px;border:0;border-radius:50%;background:#dc2626;color:#fff;font-size:18px;line-height:1}
            .maid-camera-hint{margin:0;padding:0 16px 12px;color:#cbd5e1;text-align:center;font-weight:700}
            .maid-camera-panel>footer{display:grid;grid-template-columns:110px 1fr;gap:10px;padding:12px 14px 18px;margin-top:auto;background:#0f172a;position:sticky;bottom:0}.maid-camera-panel>footer button{min-height:56px;border-radius:12px;font-weight:900;font-size:15px}.maid-cancel-action{border:1px solid #64748b;background:#1e293b;color:#fff}.maid-submit-action{border:0;background:#16a34a;color:#fff}
            @media (max-width:520px){.maid-camera-actions{grid-template-columns:1fr 1fr}.maid-gallery-action{grid-column:1/-1}.maid-camera-view,.maid-camera-view video{min-height:43vh}.maid-camera-panel>footer{grid-template-columns:90px 1fr}}
          `}</style>
        </div>
      ) : null}

    </>
  );
}
