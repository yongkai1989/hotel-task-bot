import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const images: string[] = body.images || [];

    if (!images.length) {
      return NextResponse.json({ ok: false, error: 'No images provided' }, { status: 400 });
    }

    const uploadedUrls: string[] = [];

    for (let i = 0; i < images.length; i++) {
      const base64 = images[i];

      // remove data:image/... prefix
      const base64Data = base64.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      const fileName = `task-${Date.now()}-${i}.jpg`;

      const { error } = await supabaseAdmin.storage
        .from('task-images')
        .upload(fileName, buffer, {
          contentType: 'image/jpeg',
        });

      if (error) {
        throw error;
      }

      const { data } = supabaseAdmin.storage
        .from('task-images')
        .getPublicUrl(fileName);

      uploadedUrls.push(data.publicUrl);
    }

    return NextResponse.json({ ok: true, urls: uploadedUrls });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
