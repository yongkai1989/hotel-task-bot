import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, status } = body;

    if (!taskId || !status) {
      return NextResponse.json(
        { ok: false, error: 'Missing taskId or status' },
        { status: 400 }
      );
    }

    const updateData: Record<string, any> = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'DONE') {
      updateData.done_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    await supabaseAdmin.from('task_events').insert({
      task_id: taskId,
      event_type: status,
      event_text: `Dashboard changed status to ${status}`,
      created_at: new Date().toISOString()
    });

    return NextResponse.json({ ok: true, task: data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
