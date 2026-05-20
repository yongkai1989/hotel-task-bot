import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getDashboardUserFromRequest } from '../../../lib/dashboardAuth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const MAX_MEDIA = 30;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function jsonNoCache(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
}

function extensionFor(type: string) {
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4')) return 'mp4';
  return type.startsWith('video/') ? 'mp4' : 'jpg';
}

function mediaTypeFor(type: string): 'image' | 'video' {
  return type.startsWith('video/') ? 'video' : 'image';
}

async function uploadBuffer(params: {
  buffer: Buffer;
  contentType: string;
  index: number;
  name?: string;
  folder?: string;
}) {
  const mediaType = mediaTypeFor(params.contentType);
  const ext = extensionFor(params.contentType);
  const folder = String(params.folder || 'task-media').replace(/[^a-z0-9-_/]/gi, '') || 'task-media';
  const fileName = `${folder}/${Date.now()}-${params.index}-${Math.random()
    .toString(36)
    .slice(2)}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from('task-images')
    .upload(fileName, params.buffer, {
      contentType: params.contentType,
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabaseAdmin.storage
    .from('task-images')
    .getPublicUrl(fileName);

  return {
    url: data.publicUrl,
    path: fileName,
    media_type: mediaType,
    caption: params.name || null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await getDashboardUserFromRequest(req);

    if (!user) {
      return jsonNoCache({ ok: false, error: authError || 'Unauthorized' }, 401);
    }

    if (
      !user.can_create_task &&
      !user.can_edit_task &&
      !user.can_access_maintenance_manager_room_check &&
      !user.can_access_hk_manager_room_check
    ) {
      return jsonNoCache({ ok: false, error: 'Upload access denied' }, 403);
    }

    const contentType = req.headers.get('content-type') || '';
    const uploaded: any[] = [];

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const folder = String(form.get('folder') || 'task-media');
      const files = form
        .getAll('media')
        .filter((item): item is File => {
          const candidate = item as any;
          return (
            candidate &&
            typeof candidate.arrayBuffer === 'function' &&
            typeof candidate.size === 'number'
          );
        });

      if (!files.length) {
        return jsonNoCache({ ok: false, error: 'No media provided' }, 400);
      }

      if (files.length > MAX_MEDIA) {
        return jsonNoCache({ ok: false, error: `Maximum ${MAX_MEDIA} media files per task` }, 400);
      }

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const type = file.type || 'application/octet-stream';
        const isVideo = type.startsWith('video/');
        const isImage = type.startsWith('image/');

        if (!isVideo && !isImage) {
          return jsonNoCache({ ok: false, error: 'Only image and video files are allowed' }, 400);
        }

        if (isVideo && file.size > MAX_VIDEO_BYTES) {
          return jsonNoCache({ ok: false, error: 'Each video must be 80MB or smaller' }, 400);
        }

        if (isImage && file.size > MAX_IMAGE_BYTES) {
          return jsonNoCache({ ok: false, error: 'Each image must be 8MB or smaller after compression' }, 400);
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        uploaded.push(
          await uploadBuffer({
            buffer,
            contentType: type,
            index: i,
            name: file.name,
            folder,
          })
        );
      }
    } else {
      const body = await req.json();
      const images: string[] = body.images || [];

      if (!images.length) {
        return jsonNoCache({ ok: false, error: 'No images provided' }, 400);
      }

      if (images.length > MAX_MEDIA) {
        return jsonNoCache({ ok: false, error: `Maximum ${MAX_MEDIA} images per task` }, 400);
      }

      for (let i = 0; i < images.length; i += 1) {
        const base64 = images[i];
        const match = base64.match(/^data:([^;]+);base64,(.+)$/);
        const type = match?.[1] || 'image/jpeg';
        const payload = match?.[2] || base64.split(',')[1] || '';

        if (!type.startsWith('image/')) {
          return jsonNoCache({ ok: false, error: 'Only image data URLs are allowed in JSON uploads' }, 400);
        }

        const buffer = Buffer.from(payload, 'base64');
        if (buffer.byteLength > MAX_IMAGE_BYTES) {
          return jsonNoCache({ ok: false, error: 'Each image must be 8MB or smaller after compression' }, 400);
        }

        uploaded.push(
          await uploadBuffer({
            buffer,
            contentType: type,
            index: i,
            name: body.image_captions?.[i] || null,
          })
        );
      }
    }

    return jsonNoCache({
      ok: true,
      items: uploaded,
      urls: uploaded.map((item) => item.url),
    });
  } catch (err: any) {
    return jsonNoCache(
      { ok: false, error: err?.message || 'Failed to upload media' },
      500
    );
  }
}
