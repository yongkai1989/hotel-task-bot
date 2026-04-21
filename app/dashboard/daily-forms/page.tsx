'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type Profile = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
};

type Template = {
  id: string;
  title: string;
  is_active: boolean;
};

type Question = {
  id: string;
  template_id: string;
  question_text: string;
  answer_mode: 'YES_NO' | 'SHORT_TEXT';
  sort_order: number;
};

type Submission = {
  id: string;
  template_id: string;
  submission_date: string;
};

type Answer = {
  question_id: string;
  answer_yes_no: boolean | null;
  answer_text: string | null;
};

function getToday() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function DailyFormsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newQuestions, setNewQuestions] = useState<{text:string, mode:'YES_NO'|'SHORT_TEXT'}[]>([]);

  const supabase = createBrowserSupabaseClient();
  const today = getToday();

  const isSuper = profile?.role === 'SUPERUSER';
  const isManager = profile?.role === 'MANAGER';

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('user_id,email,name,role')
        .eq('user_id', session.user.id)
        .single();

      setProfile(prof);
    }
    init();
  }, []);

  useEffect(() => {
    if (!profile) return;
    loadAll();
  }, [profile]);

  async function loadAll() {
    setLoading(true);

    const { data: t } = await supabase
      .from('daily_form_templates')
      .select('*')
      .eq('is_active', true);

    const template = t?.[0];
    setTemplates(t || []);

    if (!template) {
      setLoading(false);
      return;
    }

    const { data: q } = await supabase
      .from('daily_form_questions')
      .select('*')
      .eq('template_id', template.id)
      .order('sort_order');

    setQuestions(q || []);

    const { data: sub } = await supabase
      .from('daily_form_submissions')
      .select('*')
      .eq('template_id', template.id)
      .eq('submission_date', today)
      .maybeSingle();

    if (sub) {
      setSubmission(sub);

      const { data: ans } = await supabase
        .from('daily_form_answers')
        .select('*')
        .eq('submission_id', sub.id);

      const map: Record<string, Answer> = {};
      ans?.forEach((a:any) => {
        map[a.question_id] = a;
      });
      setAnswers(map);
    }

    setLoading(false);
  }

  function updateAnswer(q: Question, value: any) {
    setAnswers(prev => ({
      ...prev,
      [q.id]: {
        question_id: q.id,
        answer_yes_no: q.answer_mode === 'YES_NO' ? value : null,
        answer_text: q.answer_mode === 'SHORT_TEXT' ? value : null,
      }
    }));
  }

  async function submitForm() {
    const template = templates[0];
    if (!template) return;

    let subId = submission?.id;

    if (!subId) {
      const { data: newSub } = await supabase
        .from('daily_form_submissions')
        .insert({
          template_id: template.id,
          submission_date: today,
          submitted_by_user_id: profile?.user_id,
          submitted_by_name: profile?.name,
          submitted_by_email: profile?.email,
        })
        .select()
        .single();

      subId = newSub.id;
      setSubmission(newSub);

      await fetch('/api/daily-forms-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checklistTitle: template.title,
          submittedBy: profile?.name,
          date: today,
        }),
      });
    }

    for (const q of questions) {
      const a = answers[q.id];
      if (!a) continue;

      await supabase
        .from('daily_form_answers')
        .upsert({
          submission_id: subId,
          question_id: q.id,
          answer_yes_no: a.answer_yes_no,
          answer_text: a.answer_text,
        });
    }

    alert('Saved');
  }

  async function createTemplate() {
    const { data: t } = await supabase
      .from('daily_form_templates')
      .insert({
        title: newTitle,
        is_active: true,
        created_by_name: profile?.name,
      })
      .select()
      .single();

    for (let i=0;i<newQuestions.length;i++) {
      await supabase.from('daily_form_questions').insert({
        template_id: t.id,
        question_text: newQuestions[i].text,
        answer_mode: newQuestions[i].mode,
        sort_order: i,
      });
    }

    setShowCreate(false);
    location.reload();
  }

  if (!profile) return <div style={{padding:20}}>No access</div>;
  if (!(isSuper || isManager)) return <div style={{padding:20}}>Access denied</div>;

  if (loading) return <div style={{padding:20}}>Loading...</div>;

  const template = templates[0];

  return (
    <div style={{padding:20}}>
      <h1>Daily Forms</h1>

      {isSuper && (
        <button onClick={()=>setShowCreate(true)}>Create List</button>
      )}

      {template && (
        <>
          <h2>{template.title}</h2>

          {questions.map(q => (
            <div key={q.id} style={{marginBottom:10}}>
              <div>{q.question_text}</div>

              {q.answer_mode === 'YES_NO' ? (
                <>
                  <button onClick={()=>updateAnswer(q,true)}>Yes</button>
                  <button onClick={()=>updateAnswer(q,false)}>No</button>
                </>
              ) : (
                <input
                  value={answers[q.id]?.answer_text || ''}
                  onChange={(e)=>updateAnswer(q,e.target.value)}
                />
              )}
            </div>
          ))}

          <button onClick={submitForm}>
            {submission ? 'Update' : 'Submit'}
          </button>
        </>
      )}

      {showCreate && (
        <div style={{border:'1px solid black',padding:10,marginTop:20}}>
          <h3>Create List</h3>

          <input
            placeholder="Title"
            value={newTitle}
            onChange={(e)=>setNewTitle(e.target.value)}
          />

          {newQuestions.map((q,i)=>(
            <div key={i}>
              <input
                value={q.text}
                onChange={(e)=>{
                  const copy=[...newQuestions];
                  copy[i].text=e.target.value;
                  setNewQuestions(copy);
                }}
              />
              <select
                value={q.mode}
                onChange={(e)=>{
                  const copy=[...newQuestions];
                  copy[i].mode=e.target.value as any;
                  setNewQuestions(copy);
                }}
              >
                <option value="YES_NO">Yes/No</option>
                <option value="SHORT_TEXT">Short Text</option>
              </select>
            </div>
          ))}

          <button onClick={()=>setNewQuestions([...newQuestions,{text:'',mode:'YES_NO'}])}>
            Add Question
          </button>

          <button onClick={createTemplate}>Save</button>
        </div>
      )}
    </div>
  );
}
