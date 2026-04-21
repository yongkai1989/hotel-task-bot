'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
  created_by_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Question = {
  id: string;
  template_id: string;
  question_text: string;
  question_description?: string | null;
  answer_mode: 'YES_NO' | 'SHORT_TEXT';
  sort_order: number;
  is_required: boolean;
};

type Submission = {
  id: string;
  template_id: string;
  submission_date: string;
  submitted_by_user_id?: string | null;
  submitted_by_name?: string | null;
  submitted_by_email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AnswerRow = {
  id?: string;
  submission_id?: string;
  question_id: string;
  answer_yes_no: boolean | null;
  answer_text: string | null;
};

type DraftQuestion = {
  existingId?: string;
  question_text: string;
  question_description: string;
  answer_mode: 'YES_NO' | 'SHORT_TEXT';
  is_required: boolean;
};

type ViewMode = 'LIST' | 'FORM' | 'HISTORY' | 'VIEW_SUBMISSION';

function getTodayLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserSupabaseClient();
}

export default function DailyFormsPage() {
  const supabase = useMemo(() => getSupabaseSafe(), []);
  const today = getTodayLocalDateString();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [todaySubmission, setTodaySubmission] = useState<Submission | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerRow>>({});
  const [pastSubmissions, setPastSubmissions] = useState<Submission[]>([]);
  const [viewingSubmission, setViewingSubmission] = useState<Submission | null>(null);
  const [viewingAnswers, setViewingAnswers] = useState<Record<string, AnswerRow>>({});

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('LIST');

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateModalMode, setTemplateModalMode] = useState<'CREATE' | 'EDIT'>('CREATE');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftQuestions, setDraftQuestions] = useState<DraftQuestion[]>([
    { question_text: '', question_description: '', answer_mode: 'YES_NO', is_required: false },
  ]);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isSuper = profile?.role === 'SUPERUSER';
  const isManager = profile?.role === 'MANAGER';
  const canAccess = !!profile && (isSuper || isManager);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const selectedQuestions = useMemo(
    () =>
      questions
        .filter((question) => question.template_id === selectedTemplateId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [questions, selectedTemplateId]
  );

  const templateTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    templates.forEach((template) => map.set(template.id, template.title));
    return map;
  }, [templates]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        if (!supabase) throw new Error('Supabase is not configured.');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session?.user) {
          if (!mounted) return;
          setProfile(null);
          return;
        }

        const { data: profileRow, error: profileError } = await supabase
          .from('user_profiles')
          .select('user_id, email, name, role')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!mounted) return;

        setProfile({
          user_id: session.user.id,
          email: profileRow?.email || session.user.email || '',
          name: profileRow?.name || session.user.email || 'User',
          role: (profileRow?.role || 'FO') as Profile['role'],
        });
      } catch (err: any) {
        if (!mounted) return;
        setErrorMsg(err?.message || 'Failed to load session');
      } finally {
        if (mounted) setAuthLoading(false);
      }
    }

    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!profile || !canAccess) {
      setLoading(false);
      return;
    }
    void loadTemplatesAndQuestions();
  }, [profile, canAccess]);

  useEffect(() => {
    if (!selectedTemplateId || !profile?.user_id) return;
    void loadTemplateSubmissionState(selectedTemplateId);
  }, [selectedTemplateId, profile?.user_id]);

  async function loadTemplatesAndQuestions() {
    if (!supabase) return;

    try {
      setLoading(true);
      setErrorMsg('');

      const [templateRes, questionRes] = await Promise.all([
        supabase
          .from('daily_form_templates')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('daily_form_questions')
          .select('*')
          .order('sort_order', { ascending: true }),
      ]);

      if (templateRes.error) throw templateRes.error;
      if (questionRes.error) throw questionRes.error;

      const nextTemplates = (templateRes.data || []) as Template[];
      const nextQuestions = (questionRes.data || []) as Question[];

      setTemplates(nextTemplates);
      setQuestions(nextQuestions);

      if (!selectedTemplateId && nextTemplates.length > 0) {
        setSelectedTemplateId(nextTemplates[0].id);
      } else if (
        selectedTemplateId &&
        !nextTemplates.find((template) => template.id === selectedTemplateId)
      ) {
        setSelectedTemplateId(nextTemplates[0]?.id || null);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load forms');
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplateSubmissionState(templateId: string) {
    if (!supabase || !profile?.user_id) return;

    try {
      setLoading(true);
      setErrorMsg('');
      setSuccessMsg('');

      const startDate = (() => {
        const d = new Date(`${today}T00:00:00`);
        d.setDate(d.getDate() - 29);
        return d.toISOString().slice(0, 10);
      })();

      const [submissionRes, pastRes] = await Promise.all([
        supabase
          .from('daily_form_submissions')
          .select('*')
          .eq('template_id', templateId)
          .eq('submission_date', today)
          .eq('submitted_by_user_id', profile.user_id)
          .maybeSingle(),
        supabase
          .from('daily_form_submissions')
          .select('*')
          .eq('template_id', templateId)
          .gte('submission_date', startDate)
          .order('submission_date', { ascending: false })
          .order('created_at', { ascending: false }),
      ]);

      if (submissionRes.error) throw submissionRes.error;
      if (pastRes.error) throw pastRes.error;

      const currentSubmission = submissionRes.data as Submission | null;
      setTodaySubmission(currentSubmission);
      setPastSubmissions((pastRes.data || []) as Submission[]);

      if (currentSubmission) {
        const { data: answerRows, error: answerError } = await supabase
          .from('daily_form_answers')
          .select('*')
          .eq('submission_id', currentSubmission.id);

        if (answerError) throw answerError;

        const nextAnswers: Record<string, AnswerRow> = {};
        (answerRows || []).forEach((row: any) => {
          nextAnswers[row.question_id] = {
            id: row.id,
            submission_id: row.submission_id,
            question_id: row.question_id,
            answer_yes_no: row.answer_yes_no,
            answer_text: row.answer_text,
          };
        });
        setAnswers(nextAnswers);
      } else {
        setAnswers({});
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load submission state');
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setTemplateModalMode('CREATE');
    setDraftTitle('');
    setDraftQuestions([
      { question_text: '', question_description: '', answer_mode: 'YES_NO', is_required: false },
    ]);
    setShowTemplateModal(true);
    setErrorMsg('');
    setSuccessMsg('');
  }

  function openEditModal() {
    if (!selectedTemplate) return;

    setTemplateModalMode('EDIT');
    setDraftTitle(selectedTemplate.title);
    setDraftQuestions(
      selectedQuestions.map((question) => ({
        existingId: question.id,
        question_text: question.question_text,
        question_description: question.question_description || '',
        answer_mode: question.answer_mode,
        is_required: question.is_required ?? false,
      }))
    );
    setShowTemplateModal(true);
    setErrorMsg('');
    setSuccessMsg('');
  }

  function closeTemplateModal() {
    if (templateSaving) return;
    setShowTemplateModal(false);
  }

  function updateDraftQuestion(index: number, field: keyof DraftQuestion, value: string | boolean) {
    setDraftQuestions((prev) =>
      prev.map((question, i) =>
        i === index ? { ...question, [field]: value } as DraftQuestion : question
      )
    );
  }

  function addDraftQuestion() {
    setDraftQuestions((prev) => [
      ...prev,
      { question_text: '', question_description: '', answer_mode: 'YES_NO', is_required: false },
    ]);
  }

  function removeDraftQuestion(index: number) {
    setDraftQuestions((prev) => {
      if (prev.length === 1) return prev;
      const item = prev[index];
      if (item?.existingId) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSaveTemplate() {
    if (!supabase || !profile?.user_id) return;

    const title = draftTitle.trim();
    if (!title) {
      setErrorMsg('Please enter a form title.');
      return;
    }

    const cleanedQuestions = draftQuestions
      .map((question) => ({
        ...question,
        question_text: question.question_text.trim(),
        question_description: question.question_description.trim(),
        is_required: question.is_required ?? false,
      }))
      .filter((question) => question.question_text);

    if (cleanedQuestions.length === 0) {
      setErrorMsg('Please add at least one question.');
      return;
    }

    try {
      setTemplateSaving(true);
      setErrorMsg('');
      setSuccessMsg('');

      if (templateModalMode === 'CREATE') {
        const { data: template, error: templateError } = await supabase
          .from('daily_form_templates')
          .insert([
            {
              title,
              is_active: true,
              created_by_user_id: profile.user_id,
              created_by_name: profile.name || profile.email,
            },
          ])
          .select('*')
          .single();

        if (templateError) throw templateError;

        const questionRows = cleanedQuestions.map((question, index) => ({
          template_id: template.id,
          question_text: question.question_text,
          question_description: question.question_description || null,
          answer_mode: question.answer_mode,
          is_required: question.is_required,
          sort_order: index,
        }));

        const { error: questionError } = await supabase
          .from('daily_form_questions')
          .insert(questionRows);

        if (questionError) throw questionError;

        setSelectedTemplateId(template.id);
        setSuccessMsg('List created successfully.');
      } else {
        if (!selectedTemplate) throw new Error('No list selected.');

        const { error: templateError } = await supabase
          .from('daily_form_templates')
          .update({
            title,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedTemplate.id);

        if (templateError) throw templateError;

        for (let i = 0; i < cleanedQuestions.length; i += 1) {
          const question = cleanedQuestions[i];

          if (question.existingId) {
            const { error: updateError } = await supabase
              .from('daily_form_questions')
              .update({
                question_text: question.question_text,
                question_description: question.question_description || null,
                answer_mode: question.answer_mode,
                is_required: question.is_required,
                sort_order: i,
              })
              .eq('id', question.existingId);

            if (updateError) throw updateError;
          } else {
            const { error: insertError } = await supabase
              .from('daily_form_questions')
              .insert([
                {
                  template_id: selectedTemplate.id,
                  question_text: question.question_text,
                  question_description: question.question_description || null,
                  answer_mode: question.answer_mode,
                  is_required: question.is_required,
                  sort_order: i,
                },
              ]);

            if (insertError) throw insertError;
          }
        }

        setSuccessMsg('List updated successfully.');
      }

      setShowTemplateModal(false);
      await loadTemplatesAndQuestions();
      if (selectedTemplateId) {
        await loadTemplateSubmissionState(selectedTemplateId);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save list');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    if (!supabase) return;

    const confirmed = window.confirm(
      'Delete this list? Existing submission history stays in the database, but the list will be hidden from active use.'
    );
    if (!confirmed) return;

    try {
      setDeletingTemplateId(templateId);
      setErrorMsg('');
      setSuccessMsg('');

      const { error } = await supabase
        .from('daily_form_templates')
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', templateId);

      if (error) throw error;

      setSelectedTemplateId(null);
      setTodaySubmission(null);
      setAnswers({});
      setPastSubmissions([]);
      setViewMode('LIST');
      setSuccessMsg('List deleted successfully.');
      await loadTemplatesAndQuestions();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete list');
    } finally {
      setDeletingTemplateId(null);
    }
  }

  function chooseTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    setViewingSubmission(null);
    setViewingAnswers({});
    setViewMode('FORM');
  }

  function updateAnswer(question: Question, value: boolean | string) {
    setAnswers((prev) => ({
      ...prev,
      [question.id]: {
        ...prev[question.id],
        question_id: question.id,
        answer_yes_no: question.answer_mode === 'YES_NO' ? Boolean(value) : null,
        answer_text: question.answer_mode === 'SHORT_TEXT' ? String(value) : null,
      },
    }));
  }

  async function handleSaveSubmission() {
    if (!supabase || !profile?.user_id || !selectedTemplate) return;

    for (const question of selectedQuestions) {
      if (!question.is_required) continue;

      const answer = answers[question.id];

      if (question.answer_mode === 'YES_NO') {
        if (answer?.answer_yes_no !== true && answer?.answer_yes_no !== false) {
          setErrorMsg(`Please answer required question: ${question.question_text}`);
          return;
        }
      } else {
        if (!answer?.answer_text || !answer.answer_text.trim()) {
          setErrorMsg(`Please answer required question: ${question.question_text}`);
          return;
        }
      }
    }

    try {
      setSavingAnswers(true);
      setErrorMsg('');
      setSuccessMsg('');

      let submissionId = todaySubmission?.id || null;
      let createdNewSubmission = false;

      if (!submissionId) {
        const { data: createdSubmission, error: submissionError } = await supabase
          .from('daily_form_submissions')
          .insert([
            {
              template_id: selectedTemplate.id,
              submission_date: today,
              submitted_by_user_id: profile.user_id,
              submitted_by_name: profile.name || profile.email,
              submitted_by_email: profile.email,
            },
          ])
          .select('*')
          .single();

        if (submissionError) throw submissionError;
        submissionId = createdSubmission.id;
        createdNewSubmission = true;
      } else {
        const { error: updateSubmissionError } = await supabase
          .from('daily_form_submissions')
          .update({
            updated_at: new Date().toISOString(),
          })
          .eq('id', submissionId);

        if (updateSubmissionError) throw updateSubmissionError;
      }

      const rows = selectedQuestions.map((question) => ({
        submission_id: submissionId,
        question_id: question.id,
        answer_yes_no:
          question.answer_mode === 'YES_NO'
            ? answers[question.id]?.answer_yes_no ?? null
            : null,
        answer_text:
          question.answer_mode === 'SHORT_TEXT'
            ? (answers[question.id]?.answer_text || '').trim() || null
            : null,
      }));

      const { error: answerError } = await supabase
        .from('daily_form_answers')
        .upsert(rows, { onConflict: 'submission_id,question_id' });

      if (answerError) throw answerError;

      await fetch('/api/daily-forms-telegram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          checklistTitle: selectedTemplate.title,
          submittedBy: profile.name || profile.email,
          date: today,
          action: createdNewSubmission ? 'submit' : 'update',
          answers: selectedQuestions.map((question) => ({
            question_text: question.question_text,
            answer_mode: question.answer_mode,
            answer_yes_no:
              question.answer_mode === 'YES_NO'
                ? answers[question.id]?.answer_yes_no ?? null
                : null,
          })),
        }),
      });

      setSuccessMsg(
        createdNewSubmission ? 'Form submitted successfully.' : 'Answers updated successfully.'
      );

      await loadTemplateSubmissionState(selectedTemplate.id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save form');
    } finally {
      setSavingAnswers(false);
    }
  }

  async function openHistorySubmission(submission: Submission) {
    if (!supabase) return;

    try {
      setLoading(true);
      setViewMode('VIEW_SUBMISSION');
      setViewingSubmission(submission);

      const { data: answerRows, error } = await supabase
        .from('daily_form_answers')
        .select('*')
        .eq('submission_id', submission.id);

      if (error) throw error;

      const nextAnswers: Record<string, AnswerRow> = {};
      (answerRows || []).forEach((row: any) => {
        nextAnswers[row.question_id] = {
          id: row.id,
          submission_id: row.submission_id,
          question_id: row.question_id,
          answer_yes_no: row.answer_yes_no,
          answer_text: row.answer_text,
        };
      });

      setViewingAnswers(nextAnswers);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load submission details');
    } finally {
      setLoading(false);
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
          <p style={styles.centerText}>Only managers and superusers can access Daily Forms.</p>
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
            <div style={styles.pageTitle}>Daily Forms</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role}) · Manager daily checklist workspace
            </div>
          </div>

          <div style={styles.topBarActions}>
            {isSuper ? (
              <button type="button" onClick={openCreateModal} style={styles.primaryHeaderBtn}>
                Create List
              </button>
            ) : null}
            <Link href="/dashboard" style={styles.secondaryBtn}>Back to Dashboard</Link>
          </div>
        </div>

        {errorMsg ? <div style={styles.errorBox}>{errorMsg}</div> : null}
        {successMsg ? <div style={styles.successBox}>{successMsg}</div> : null}

        <div style={styles.modeRow}>
          <button
            type="button"
            onClick={() => setViewMode('LIST')}
            style={{ ...styles.modeBtn, ...(viewMode === 'LIST' ? styles.modeBtnActive : {}) }}
          >
            Forms
          </button>
          {selectedTemplate ? (
            <button
              type="button"
              onClick={() => setViewMode('HISTORY')}
              style={{ ...styles.modeBtn, ...(viewMode === 'HISTORY' ? styles.modeBtnActive : {}) }}
            >
              Last 30 Days
            </button>
          ) : null}
        </div>

        {loading ? (
          <section style={styles.panel}>
            <div style={styles.emptyState}>Loading daily forms...</div>
          </section>
        ) : null}

        {!loading && templates.length === 0 ? (
          <section style={styles.panel}>
            <div style={styles.emptyState}>
              No forms available yet. {isSuper ? 'Create your first list to get started.' : 'Please ask a superuser to create a list.'}
            </div>
          </section>
        ) : null}

        {!loading && viewMode === 'LIST' && templates.length > 0 ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Available Forms</div>
            <div style={styles.formCardGrid}>
              {templates.map((template) => {
                const templateQuestions = questions.filter((q) => q.template_id === template.id);

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => chooseTemplate(template.id)}
                    style={{
                      ...styles.formChooserCard,
                      ...(selectedTemplateId === template.id ? styles.formChooserCardActive : {}),
                    }}
                  >
                    <div style={styles.formChooserTitle}>{template.title}</div>
                    <div style={styles.formChooserMeta}>
                      {templateQuestions.length} question{templateQuestions.length === 1 ? '' : 's'}
                    </div>
                    <div style={styles.formChooserHint}>Open Form</div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {!loading && viewMode === 'FORM' && selectedTemplate ? (
          <section style={styles.panel}>
            <div style={styles.formHeader}>
              <div>
                <div style={styles.sectionTitle}>{selectedTemplate.title}</div>
                <div style={styles.formSubMeta}>
                  {todaySubmission
                    ? `Submitted on ${formatDateTime(todaySubmission.created_at)}`
                    : `No submission yet for ${formatDate(today)}`}
                </div>
                {todaySubmission?.updated_at && todaySubmission.updated_at !== todaySubmission.created_at ? (
                  <div style={styles.formSubMeta}>
                    Last updated: {formatDateTime(todaySubmission.updated_at)}
                  </div>
                ) : null}
              </div>

              <div style={styles.formHeaderRight}>
                {isSuper ? (
                  <>
                    <button type="button" onClick={openEditModal} style={styles.secondaryBtn}>
                      Edit List
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTemplate(selectedTemplate.id)}
                      style={{ ...styles.secondaryBtn, color: '#ef4444', borderColor: '#ef4444' }}
                      disabled={deletingTemplateId === selectedTemplate.id}
                    >
                      {deletingTemplateId === selectedTemplate.id ? 'Deleting...' : 'Delete List'}
                    </button>
                  </>
                ) : null}

                <div
                  style={{
                    ...styles.statusPill,
                    ...(todaySubmission ? styles.statusSubmitted : styles.statusPending),
                  }}
                >
                  {todaySubmission ? 'Submitted Today' : 'Pending Today'}
                </div>
              </div>
            </div>

            <div style={styles.questionList}>
              {selectedQuestions.map((question, index) => (
                <div key={question.id} style={styles.questionCard}>
                  <div style={styles.questionNumber}>Question {index + 1}</div>

                  <div style={styles.questionTitleRow}>
                    <div style={styles.questionText}>{question.question_text}</div>
                    {question.is_required ? (
                      <span style={styles.requiredBadge}>Required</span>
                    ) : null}
                  </div>

                  {question.question_description ? (
                    <div style={styles.questionDescription}>{question.question_description}</div>
                  ) : null}

                  {question.answer_mode === 'YES_NO' ? (
                    <div style={styles.answerBtnRow}>
                      <button
                        type="button"
                        onClick={() => updateAnswer(question, true)}
                        style={{
                          ...styles.answerChoiceBtn,
                          ...(answers[question.id]?.answer_yes_no === true
                            ? styles.answerChoiceBtnActive
                            : {}),
                        }}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAnswer(question, false)}
                        style={{
                          ...styles.answerChoiceBtn,
                          ...(answers[question.id]?.answer_yes_no === false
                            ? styles.answerChoiceBtnActive
                            : {}),
                        }}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <textarea
                      value={answers[question.id]?.answer_text || ''}
                      onChange={(e) => updateAnswer(question, e.target.value)}
                      style={styles.textarea}
                      placeholder="Enter short answer"
                    />
                  )}
                </div>
              ))}
            </div>

            <div style={styles.actionRow}>
              <button type="button" onClick={() => setViewMode('LIST')} style={styles.secondaryBtn}>
                Back to Forms
              </button>
              <button
                type="button"
                onClick={() => void handleSaveSubmission()}
                style={{ ...styles.primaryBtn, opacity: savingAnswers ? 0.6 : 1 }}
                disabled={savingAnswers}
              >
                {savingAnswers ? 'Saving...' : todaySubmission ? 'Update Answers' : 'Submit Form'}
              </button>
            </div>
          </section>
        ) : null}

        {!loading && viewMode === 'HISTORY' && selectedTemplate ? (
          <section style={styles.panel}>
            <div style={styles.sectionTitle}>Last 30 Days Submissions</div>

            {pastSubmissions.length === 0 ? (
              <div style={styles.emptyState}>No submissions found for the last 30 days.</div>
            ) : (
              <div style={styles.historyList}>
                {pastSubmissions.map((submission) => (
                  <button
                    key={submission.id}
                    type="button"
                    onClick={() => void openHistorySubmission(submission)}
                    style={styles.historyCard}
                  >
                    <div>
                      <div style={styles.historyTitle}>
                        {submission.submitted_by_name || submission.submitted_by_email || 'Unknown'}
                      </div>
                      <div style={styles.historyMeta}>
                        {templateTitleMap.get(submission.template_id) || 'Form'} · {formatDate(submission.submission_date)} · {formatDateTime(submission.created_at)}
                      </div>
                    </div>
                    <div style={styles.historyView}>View</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {!loading && viewMode === 'VIEW_SUBMISSION' && viewingSubmission ? (
          <section style={styles.panel}>
            <div style={styles.formHeader}>
              <div>
                <div style={styles.sectionTitle}>
                  {templateTitleMap.get(viewingSubmission.template_id) || 'Submission'}
                </div>
                <div style={styles.formSubMeta}>
                  Submission by {viewingSubmission.submitted_by_name || viewingSubmission.submitted_by_email || '-'}
                </div>
                <div style={styles.formSubMeta}>
                  {formatDate(viewingSubmission.submission_date)} · {formatDateTime(viewingSubmission.created_at)}
                </div>
              </div>
            </div>

            <div style={styles.questionList}>
              {questions
                .filter((q) => q.template_id === viewingSubmission.template_id)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((question, index) => (
                  <div key={question.id} style={styles.questionCard}>
                    <div style={styles.questionNumber}>Question {index + 1}</div>

                    <div style={styles.questionTitleRow}>
                      <div style={styles.questionText}>{question.question_text}</div>
                      {question.is_required ? (
                        <span style={styles.requiredBadge}>Required</span>
                      ) : null}
                    </div>

                    {question.question_description ? (
                      <div style={styles.questionDescription}>{question.question_description}</div>
                    ) : null}

                    <div style={styles.viewAnswerBox}>
                      {question.answer_mode === 'YES_NO'
                        ? viewingAnswers[question.id]?.answer_yes_no === null ||
                          viewingAnswers[question.id]?.answer_yes_no === undefined
                          ? '-'
                          : viewingAnswers[question.id]?.answer_yes_no
                          ? 'Yes'
                          : 'No'
                        : viewingAnswers[question.id]?.answer_text || '-'}
                    </div>
                  </div>
                ))}
            </div>

            <div style={styles.actionRow}>
              <button type="button" onClick={() => setViewMode('HISTORY')} style={styles.secondaryBtn}>
                Back to History
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {showTemplateModal ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTop}>
              <div style={styles.modalTitle}>
                {templateModalMode === 'CREATE' ? 'Create List' : 'Edit List'}
              </div>

              <button
                type="button"
                onClick={closeTemplateModal}
                style={styles.closeBtn}
                disabled={templateSaving}
              >
                ×
              </button>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Form Title</label>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                style={styles.input}
                placeholder="Example: Manager Opening Checklist"
                disabled={templateSaving}
              />
            </div>

            <div style={styles.createQuestionList}>
              {draftQuestions.map((question, index) => (
                <div key={`${question.existingId || 'new'}-${index}`} style={styles.createQuestionCard}>
                  <div style={styles.createQuestionHeader}>
                    <div style={styles.createQuestionTitle}>Question {index + 1}</div>
                    <button
                      type="button"
                      onClick={() => removeDraftQuestion(index)}
                      style={{
                        ...styles.removeBtn,
                        opacity:
                          draftQuestions.length === 1 || !!question.existingId ? 0.45 : 1,
                      }}
                      disabled={
                        templateSaving || draftQuestions.length === 1 || !!question.existingId
                      }
                    >
                      {question.existingId ? 'Locked' : 'Remove'}
                    </button>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Question</label>
                    <input
                      value={question.question_text}
                      onChange={(e) => updateDraftQuestion(index, 'question_text', e.target.value)}
                      style={styles.input}
                      placeholder="Enter question"
                      disabled={templateSaving}
                    />
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Description</label>
                    <textarea
                      value={question.question_description}
                      onChange={(e) =>
                        updateDraftQuestion(index, 'question_description', e.target.value)
                      }
                      style={styles.textareaCompact}
                      placeholder="Optional description or guidance"
                      disabled={templateSaving}
                    />
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Answer Mode</label>
                    <select
                      value={question.answer_mode}
                      onChange={(e) => updateDraftQuestion(index, 'answer_mode', e.target.value)}
                      style={styles.input}
                      disabled={templateSaving}
                    >
                      <option value="YES_NO">Yes / No</option>
                      <option value="SHORT_TEXT">Short Text</option>
                    </select>
                  </div>

                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={question.is_required}
                      onChange={(e) => updateDraftQuestion(index, 'is_required', e.target.checked)}
                      disabled={templateSaving}
                    />
                    <span>Compulsory question</span>
                  </label>

                  {question.existingId ? (
                    <div style={styles.lockNotice}>
                      Existing questions are editable, but not removable, so past submissions remain safe.
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div style={styles.modalActionsSpread}>
              <button
                type="button"
                onClick={addDraftQuestion}
                style={styles.secondaryBtn}
                disabled={templateSaving}
              >
                Add Question
              </button>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={closeTemplateModal}
                  style={styles.secondaryBtn}
                  disabled={templateSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveTemplate()}
                  style={{ ...styles.primaryBtn, opacity: templateSaving ? 0.6 : 1 }}
                  disabled={templateSaving}
                >
                  {templateSaving
                    ? 'Saving...'
                    : templateModalMode === 'CREATE'
                    ? 'Create List'
                    : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    padding: '20px 16px 40px',
  },
  shell: {
    width: '100%',
    maxWidth: '1180px',
    margin: '0 auto',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
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
    fontSize: '30px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.1,
  },
  pageSubTitle: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '24px',
    padding: '18px',
    boxShadow: '0 16px 36px rgba(15,23,42,0.06)',
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '12px',
  },
  modeRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '16px',
  },
  modeBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '999px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  modeBtnActive: {
    background: '#0f172a',
    color: '#ffffff',
    borderColor: '#0f172a',
  },
  formCardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '14px',
  },
  formChooserCard: {
    border: '1px solid #e2e8f0',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    color: '#0f172a',
    borderRadius: '22px',
    padding: '18px',
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow: '0 10px 28px rgba(15,23,42,0.05)',
  },
  formChooserCardActive: {
    borderColor: '#93c5fd',
    boxShadow: '0 14px 32px rgba(37,99,235,0.12)',
  },
  formChooserTitle: {
    fontSize: '20px',
    fontWeight: 800,
    marginBottom: '8px',
  },
  formChooserMeta: {
    fontSize: '14px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '16px',
  },
  formChooserHint: {
    fontSize: '13px',
    color: '#1d4ed8',
    fontWeight: 800,
  },
  formHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  formHeaderRight: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  formSubMeta: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
    fontWeight: 700,
  },
  statusPill: {
    borderRadius: '999px',
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: 800,
  },
  statusPending: {
    background: '#fff7ed',
    color: '#c2410c',
  },
  statusSubmitted: {
    background: '#ecfdf5',
    color: '#166534',
  },
  questionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  questionCard: {
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    borderRadius: '20px',
    padding: '16px',
  },
  questionNumber: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 800,
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  questionTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    flexWrap: 'wrap',
  },
  questionText: {
    fontSize: '18px',
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.35,
  },
  requiredBadge: {
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '12px',
    fontWeight: 800,
  },
  questionDescription: {
    fontSize: '14px',
    color: '#475569',
    lineHeight: 1.6,
    marginTop: '8px',
    whiteSpace: 'pre-wrap',
  },
  answerBtnRow: {
    display: 'flex',
    gap: '10px',
    marginTop: '14px',
    flexWrap: 'wrap',
  },
  answerChoiceBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '12px',
    padding: '12px 18px',
    fontWeight: 800,
    cursor: 'pointer',
    minWidth: '110px',
  },
  answerChoiceBtnActive: {
    background: '#0f172a',
    color: '#ffffff',
    borderColor: '#0f172a',
  },
  viewAnswerBox: {
    marginTop: '14px',
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 700,
    color: '#0f172a',
    whiteSpace: 'pre-wrap',
  },
  actionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '18px',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  historyCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    borderRadius: '16px',
    padding: '14px 16px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  historyTitle: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
  },
  historyMeta: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '4px',
    fontWeight: 700,
  },
  historyView: {
    fontSize: '13px',
    color: '#1d4ed8',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  primaryHeaderBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  primaryBtn: {
    border: 'none',
    background: '#0f172a',
    color: '#ffffff',
    borderRadius: '14px',
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
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  errorBox: {
    marginBottom: '14px',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 700,
  },
  successBox: {
    marginBottom: '14px',
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
    borderRadius: '14px',
    padding: '12px 14px',
    fontWeight: 700,
  },
  emptyState: {
    border: '1px dashed #cbd5e1',
    background: '#f8fafc',
    borderRadius: '16px',
    padding: '26px',
    textAlign: 'center',
    color: '#64748b',
    fontWeight: 700,
  },
  centerCard: {
    maxWidth: '460px',
    margin: '80px auto',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '20px',
    padding: '26px',
    textAlign: 'center',
    boxShadow: '0 14px 32px rgba(15,23,42,0.08)',
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
    lineHeight: 1.6,
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
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 800,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.48)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },
  modalCard: {
    width: '100%',
    maxWidth: '860px',
    maxHeight: '88vh',
    overflowY: 'auto',
    background: '#ffffff',
    borderRadius: '24px',
    padding: '20px',
    boxShadow: '0 20px 50px rgba(15,23,42,0.28)',
  },
  modalTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  modalTitle: {
    fontSize: '24px',
    fontWeight: 800,
    color: '#0f172a',
  },
  closeBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    width: '38px',
    height: '38px',
    borderRadius: '12px',
    fontSize: '20px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  createQuestionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  createQuestionCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    background: '#f8fafc',
    padding: '14px',
  },
  createQuestionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
    marginBottom: '10px',
  },
  createQuestionTitle: {
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
  },
  removeBtn: {
    border: '1px solid #ef4444',
    background: '#ffffff',
    color: '#ef4444',
    borderRadius: '12px',
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '14px',
  },
  label: {
    fontSize: '14px',
    color: '#334155',
    fontWeight: 800,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: '#334155',
    fontWeight: 700,
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '100px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    resize: 'vertical',
    marginTop: '14px',
  },
  textareaCompact: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '88px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '12px 14px',
    fontSize: '15px',
    outline: 'none',
    resize: 'vertical',
  },
  modalActionsSpread: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: '18px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    flexWrap: 'wrap',
  },
  lockNotice: {
    fontSize: '12px',
    color: '#b45309',
    fontWeight: 700,
  },
};
