'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';

type Profile = {
  user_id?: string;
  email: string;
  name: string;
  role: 'SUPERUSER' | 'MANAGER' | 'SUPERVISOR' | 'HK' | 'MT' | 'FO';
  can_access_supervisor_checklist?: boolean;
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

type TrackerRow = {
  user_id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  submission_id?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
};

type AnswerRow = {
  id?: string;
  submission_id?: string;
  question_id: string;
  answer_yes_no: boolean | null;
  answer_text: string | null;
  remark_text?: string | null;
};

type DraftQuestion = {
  existingId?: string;
  question_text: string;
  question_description: string;
  answer_mode: 'YES_NO' | 'SHORT_TEXT';
  is_required: boolean;
};

type ViewMode = 'LIST' | 'FORM' | 'HISTORY' | 'VIEW_SUBMISSION';

const HOUSEKEEPING_SUPERVISOR_EMAILS = [
  'hksup1@hotelhallmark.com',
  'hksup2@hotelhallmark.com',
  'hksup3@hotelhallmark.com',
];

function getTodayLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSupervisorChecklistServiceDateString() {
  const d = new Date();
  if (d.getHours() < 12) {
    d.setDate(d.getDate() - 1);
  }
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

function getTemplateSortOrder(title: string) {
  const normalized = String(title || '').trim().toLowerCase();
  if (normalized === 'morning shift') return 1;
  if (normalized === 'afternoon shift') return 2;
  if (normalized === 'night shift') return 3;
  return 100;
}

function sortTemplates(templateList: Template[]) {
  return [...templateList].sort((a, b) => {
    const orderDiff = getTemplateSortOrder(a.title) - getTemplateSortOrder(b.title);
    if (orderDiff !== 0) return orderDiff;
    return a.title.localeCompare(b.title);
  });
}

function getSupabaseSafe() {
  if (typeof window === 'undefined') return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createBrowserSupabaseClient();
}

export default function SupervisorChecklistPage() {
  const supabase = useMemo(() => getSupabaseSafe(), []);
  const today = getSupervisorChecklistServiceDateString();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(1200);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [todaySubmission, setTodaySubmission] = useState<Submission | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerRow>>({});
  const [remarkOpenByQuestionId, setRemarkOpenByQuestionId] = useState<Record<string, boolean>>({});
  const [pastSubmissions, setPastSubmissions] = useState<Submission[]>([]);
  const [trackerRows, setTrackerRows] = useState<TrackerRow[]>([]);
  const [viewingSubmission, setViewingSubmission] = useState<Submission | null>(null);
  const [viewingAnswers, setViewingAnswers] = useState<Record<string, AnswerRow>>({});
  const [submissionBackMode, setSubmissionBackMode] = useState<'LIST' | 'HISTORY'>('HISTORY');

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
  const canAccess =
    !!profile && (isSuper || profile.can_access_supervisor_checklist === true);
  const isMobile = viewportWidth <= 640;
  const isTablet = viewportWidth > 640 && viewportWidth <= 980;

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
          .select('user_id, email, name, role, can_access_supervisor_checklist')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profileError) throw profileError;
        if (!mounted) return;

        setProfile({
          user_id: session.user.id,
          email: profileRow?.email || session.user.email || '',
          name: profileRow?.name || session.user.email || 'User',
          role: (profileRow?.role || 'FO') as Profile['role'],
          can_access_supervisor_checklist: profileRow?.can_access_supervisor_checklist ?? false,
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
    if (typeof window === 'undefined') return;

    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
          .from('supervisor_checklist_templates')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('supervisor_checklist_questions')
          .select('*')
          .order('sort_order', { ascending: true }),
      ]);

      if (templateRes.error) throw templateRes.error;
      if (questionRes.error) throw questionRes.error;

      const nextTemplates = sortTemplates((templateRes.data || []) as Template[]);
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
      setErrorMsg(err?.message || 'Failed to load Supervisor Checklists');
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
          .from('supervisor_checklist_submissions')
          .select('*')
          .eq('template_id', templateId)
          .eq('submission_date', today)
          .eq('submitted_by_user_id', profile.user_id)
          .maybeSingle(),
        supabase
          .from('supervisor_checklist_submissions')
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

      try {
        const { data: trackerData, error: trackerError } = await supabase.rpc(
          'get_supervisor_checklist_tracker',
          {
            p_template_id: templateId,
            p_submission_date: today,
          }
        );

        if (trackerError) throw trackerError;
        setTrackerRows(
          ((trackerData || []) as TrackerRow[]).filter((row) =>
            HOUSEKEEPING_SUPERVISOR_EMAILS.includes(String(row.email || '').toLowerCase())
          )
        );
      } catch {
        setTrackerRows([]);
      }

      if (currentSubmission) {
        const { data: answerRows, error: answerError } = await supabase
          .from('supervisor_checklist_answers')
          .select('*')
          .eq('submission_id', currentSubmission.id);

        if (answerError) throw answerError;

        const nextAnswers: Record<string, AnswerRow> = {};
        const nextRemarkOpenByQuestionId: Record<string, boolean> = {};
        (answerRows || []).forEach((row: any) => {
          nextAnswers[row.question_id] = {
            id: row.id,
            submission_id: row.submission_id,
            question_id: row.question_id,
            answer_yes_no: row.answer_yes_no,
            answer_text: row.answer_text,
            remark_text: row.remark_text,
          };
          if (row.remark_text) {
            nextRemarkOpenByQuestionId[row.question_id] = true;
          }
        });
        setAnswers(nextAnswers);
        setRemarkOpenByQuestionId(nextRemarkOpenByQuestionId);
      } else {
        setAnswers({});
        setRemarkOpenByQuestionId({});
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
      return prev.filter((_, i) => i !== index);
    });
  }

  function moveDraftQuestion(index: number, direction: 'UP' | 'DOWN') {
    setDraftQuestions((prev) => {
      const nextIndex = direction === 'UP' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;

      const next = [...prev];
      const current = next[index];
      next[index] = next[nextIndex];
      next[nextIndex] = current;
      return next;
    });
  }

  async function handleSaveTemplate() {
    if (!supabase || !profile?.user_id) return;

    const title = draftTitle.trim();
    if (!title) {
      setErrorMsg('Please enter a Checklist Title.');
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
          .from('supervisor_checklist_templates')
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
          .from('supervisor_checklist_questions')
          .insert(questionRows);

        if (questionError) throw questionError;

        setSelectedTemplateId(template.id);
        setSuccessMsg('List created successfully.');
      } else {
        if (!selectedTemplate) throw new Error('No list selected.');

        const { error: templateError } = await supabase
          .from('supervisor_checklist_templates')
          .update({
            title,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedTemplate.id);

        if (templateError) throw templateError;

        const keptExistingQuestionIds = new Set(
          cleanedQuestions
            .map((question) => question.existingId)
            .filter(Boolean) as string[]
        );
        const removedExistingQuestionIds = selectedQuestions
          .map((question) => question.id)
          .filter((questionId) => !keptExistingQuestionIds.has(questionId));

        if (removedExistingQuestionIds.length > 0) {
          const { error: deleteQuestionsError } = await supabase
            .from('supervisor_checklist_questions')
            .delete()
            .in('id', removedExistingQuestionIds);

          if (deleteQuestionsError) throw deleteQuestionsError;
        }

        for (let i = 0; i < cleanedQuestions.length; i += 1) {
          const question = cleanedQuestions[i];

          if (question.existingId) {
            const { error: updateError } = await supabase
              .from('supervisor_checklist_questions')
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
              .from('supervisor_checklist_questions')
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
        .from('supervisor_checklist_templates')
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
    setRemarkOpenByQuestionId({});
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

  function toggleRemark(questionId: string) {
    setRemarkOpenByQuestionId((prev) => ({
      ...prev,
      [questionId]: !prev[questionId],
    }));
  }

  function updateRemark(question: Question, value: string) {
    setAnswers((prev) => ({
      ...prev,
      [question.id]: {
        ...prev[question.id],
        question_id: question.id,
        answer_yes_no: prev[question.id]?.answer_yes_no ?? null,
        answer_text: prev[question.id]?.answer_text ?? null,
        remark_text: value,
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
          .from('supervisor_checklist_submissions')
          .upsert(
            [
            {
              template_id: selectedTemplate.id,
              submission_date: today,
              submitted_by_user_id: profile.user_id,
              submitted_by_name: profile.name || profile.email,
              submitted_by_email: profile.email,
              updated_at: new Date().toISOString(),
            },
            ],
            { onConflict: 'template_id,submission_date,submitted_by_user_id' }
          )
          .select('*')
          .single();

        if (submissionError) throw submissionError;
        submissionId = createdSubmission.id;
        createdNewSubmission = true;
      } else {
        const { error: updateSubmissionError } = await supabase
          .from('supervisor_checklist_submissions')
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
        remark_text: (answers[question.id]?.remark_text || '').trim() || null,
      }));

      const { error: answerError } = await supabase
        .from('supervisor_checklist_answers')
        .upsert(rows, { onConflict: 'submission_id,question_id' });

      if (answerError) throw answerError;

      setSuccessMsg(
        createdNewSubmission ? 'Checklist submitted successfully.' : 'Checklist answers updated successfully.'
      );

      await loadTemplateSubmissionState(selectedTemplate.id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save checklist');
    } finally {
      setSavingAnswers(false);
    }
  }

  async function openHistorySubmission(submission: Submission, backMode: 'LIST' | 'HISTORY' = 'HISTORY') {
    if (!supabase) return;

    try {
      setLoading(true);
      setSubmissionBackMode(backMode);
      setViewMode('VIEW_SUBMISSION');
      setViewingSubmission(submission);

      const { data: answerRows, error } = await supabase
        .from('supervisor_checklist_answers')
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
          remark_text: row.remark_text,
        };
      });

      setViewingAnswers(nextAnswers);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load submission details');
    } finally {
      setLoading(false);
    }
  }

  function openTrackerSubmission(row: TrackerRow) {
    if (!row.submission_id || !selectedTemplate) return;

    void openHistorySubmission(
      {
        id: row.submission_id,
        template_id: selectedTemplate.id,
        submission_date: today,
        submitted_by_user_id: row.user_id,
        submitted_by_name: row.name || row.email || 'Supervisor',
        submitted_by_email: row.email || '',
        created_at: row.submitted_at || row.updated_at || null,
        updated_at: row.updated_at || row.submitted_at || null,
      },
      'LIST'
    );
  }

  function renderSubmissionTracker() {
    if (!selectedTemplate) return null;

    const submittedCount = trackerRows.filter((row) => row.submission_id).length;

    return (
      <div style={styles.trackerPanel}>
        <div style={styles.trackerHeader}>
          <div>
            <div style={styles.sectionEyebrow}>Submission Tracker</div>
            <div style={styles.trackerTitle}>
              {trackerRows.length > 0
                ? `${submittedCount}/${trackerRows.length} supervisors submitted`
                : 'No supervisors scheduled today'}
            </div>
          </div>
          <div style={styles.trackerDate}>{formatDate(today)}</div>
        </div>

        {trackerRows.length > 0 ? (
          <div style={styles.trackerGrid}>
            {trackerRows.map((row) => {
              const submitted = Boolean(row.submission_id);
              return (
                <button
                  type="button"
                  key={row.user_id}
                  onClick={() => openTrackerSubmission(row)}
                  disabled={!submitted}
                  style={{
                    ...styles.trackerCard,
                    ...(submitted ? styles.trackerCardSubmitted : styles.trackerCardPending),
                    cursor: submitted ? 'pointer' : 'default',
                  }}
                >
                  <div style={styles.trackerUser}>
                    <span style={submitted ? styles.trackerDotSubmitted : styles.trackerDotPending} />
                    <div>
                      <div style={styles.trackerName}>{row.name || row.email || 'Supervisor'}</div>
                      <div style={styles.trackerEmail}>{row.email || row.role || '-'}</div>
                    </div>
                  </div>
                  <div style={submitted ? styles.trackerStatusSubmitted : styles.trackerStatusPending}>
                    {submitted ? 'Submitted' : 'Pending'}
                  </div>
                  <div style={styles.trackerTime}>
                    {submitted ? `${formatDateTime(row.updated_at || row.submitted_at)} - View response` : 'Not submitted yet'}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={styles.trackerEmpty}>
            No housekeeping supervisors are scheduled as working for this checklist date. Off Day, AL, UPL, MC, and
            No Show are not counted as required submissions.
          </div>
        )}
      </div>
    );
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
          <p style={styles.centerText}>Only authorised Housekeeping users and superusers can access Supervisor Checklist.</p>
          <Link href="/dashboard" style={styles.linkBtn}>Back to Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ ...styles.page, padding: isMobile ? '12px 10px 28px' : styles.page.padding }}>
      <div style={styles.shell}>
        <div style={{ ...styles.topBar, ...(isMobile ? styles.topBarMobile : {}) }}>
          <div>
            <div style={styles.eyebrow}>Housekeeping Workspace</div>
            <div style={styles.pageTitle}>Supervisor Checklist</div>
            <div style={styles.pageSubTitle}>
              {profile.name} ({profile.role}) - Daily shift checklist workspace
            </div>
          </div>

          <div style={{ ...styles.topBarActions, ...(isMobile ? styles.topBarActionsMobile : {}) }}>
            {isSuper ? (
              <button
                type="button"
                onClick={openCreateModal}
                style={{ ...styles.primaryHeaderBtn, ...(isMobile ? styles.mobileActionBtn : {}) }}
              >
                Create List
              </button>
            ) : null}
            <Link href="/dashboard" style={{ ...styles.secondaryBtn, ...(isMobile ? styles.mobileCompactBtn : {}) }}>
              Back to Dashboard
            </Link>
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
            Checklists
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
          <section style={{ ...styles.panel, ...(isMobile ? styles.panelMobile : {}) }}>
            <div style={styles.emptyState}>Loading Supervisor Checklists...</div>
          </section>
        ) : null}

        {!loading && templates.length === 0 ? (
          <section style={{ ...styles.panel, ...(isMobile ? styles.panelMobile : {}) }}>
            <div style={styles.emptyState}>
              No checklists available yet. {isSuper ? 'Create your first list to get started.' : 'Please ask a superuser to create a list.'}
            </div>
          </section>
        ) : null}

        {!loading && viewMode === 'LIST' && templates.length > 0 ? (
          <section style={{ ...styles.panel, ...(isMobile ? styles.panelMobile : {}) }}>
            <div style={styles.sectionHeaderRow}>
              <div>
                <div style={styles.sectionEyebrow}>Daily Lists</div>
                <div style={styles.sectionTitle}>Available Checklists</div>
              </div>
              <div style={styles.sectionHint}>Resets at 12pm</div>
            </div>
            <div
              style={{
                ...styles.ChecklistCardGrid,
                gridTemplateColumns: isMobile
                  ? '1fr'
                  : isTablet
                  ? 'repeat(2, minmax(0, 1fr))'
                  : 'repeat(3, minmax(0, 1fr))',
              }}
            >
              {templates.map((template, index) => {
                const templateQuestions = questions.filter((q) => q.template_id === template.id);
                const selected = selectedTemplateId === template.id;

                return (
                  <article
                    key={template.id}
                    style={{
                      ...styles.ChecklistChooserCard,
                      ...(selected ? styles.ChecklistChooserCardActive : {}),
                    }}
                  >
                    <div style={styles.shiftCardTop}>
                      <div style={styles.shiftIcon}>{index + 1}</div>
                      <div style={{ ...styles.statusPill, ...(selected ? styles.statusSubmitted : styles.statusNeutral) }}>
                        {selected ? 'Selected' : 'Open'}
                      </div>
                    </div>
                    <div style={styles.ChecklistChooserTitle}>{template.title}</div>
                    <div style={styles.ChecklistChooserMeta}>
                      {templateQuestions.length} question{templateQuestions.length === 1 ? '' : 's'} - Supervisor checklist
                    </div>
                    <div style={styles.cardActionRow}>
                      <button
                        type="button"
                        onClick={() => chooseTemplate(template.id)}
                        style={styles.cardOpenBtn}
                      >
                        Open Checklist
                      </button>
                      {isSuper ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteTemplate(template.id)}
                          disabled={deletingTemplateId === template.id}
                          style={styles.cardDeleteBtn}
                        >
                          {deletingTemplateId === template.id ? 'Deleting...' : 'Delete'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
            {selectedTemplate ? renderSubmissionTracker() : null}
          </section>
        ) : null}

        {!loading && viewMode === 'FORM' && selectedTemplate ? (
          <section style={{ ...styles.panel, ...(isMobile ? styles.panelMobile : {}) }}>
            <div style={styles.ChecklistHeader}>
              <div>
                <div style={styles.sectionEyebrow}>Current Checklist</div>
                <div style={styles.sectionTitle}>{selectedTemplate.title}</div>
                <div style={styles.ChecklistsubMeta}>
                  {todaySubmission
                    ? `Submitted on ${formatDateTime(todaySubmission.created_at)}`
                    : `No submission yet for ${formatDate(today)}`}
                </div>
                {todaySubmission?.updated_at && todaySubmission.updated_at !== todaySubmission.created_at ? (
                  <div style={styles.ChecklistsubMeta}>
                    Last updated: {formatDateTime(todaySubmission.updated_at)}
                  </div>
                ) : null}
              </div>

              <div style={{ ...styles.ChecklistHeaderRight, ...(isMobile ? styles.headerRightMobile : {}) }}>
                {isSuper ? (
                  <>
                    <button
                      type="button"
                      onClick={openEditModal}
                      style={{ ...styles.secondaryBtn, ...(isMobile ? styles.mobileActionBtn : {}) }}
                    >
                      Edit List
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTemplate(selectedTemplate.id)}
                      style={{
                        ...styles.secondaryBtn,
                        ...(isMobile ? styles.mobileActionBtn : {}),
                        color: '#ef4444',
                        borderColor: '#fecaca',
                      }}
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

            {renderSubmissionTracker()}

            <div style={styles.questionList}>
              {selectedQuestions.map((question, index) => (
                <div key={question.id} style={{ ...styles.questionCard, ...(isMobile ? styles.questionCardMobile : {}) }}>
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
                      style={{ ...styles.textarea, ...(isMobile ? styles.textareaMobile : {}) }}
                      placeholder="Enter short answer"
                    />
                  )}

                  <div style={styles.remarkArea}>
                    {remarkOpenByQuestionId[question.id] ? (
                      <textarea
                        value={answers[question.id]?.remark_text || ''}
                        onChange={(e) => updateRemark(question, e.target.value)}
                        style={{ ...styles.remarkTextarea, ...(isMobile ? styles.textareaCompactMobile : {}) }}
                        placeholder="Add remark for this question"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleRemark(question.id)}
                        style={styles.addRemarkBtn}
                      >
                        + Remark
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ ...styles.actionRow, ...(isMobile ? styles.actionRowMobile : {}) }}>
              <button
                type="button"
                onClick={() => setViewMode('LIST')}
                style={{ ...styles.secondaryBtn, ...(isMobile ? styles.mobileActionBtn : {}) }}
              >
                Back to Checklists
              </button>
              <button
                type="button"
                onClick={() => void handleSaveSubmission()}
                style={{
                  ...styles.primaryBtn,
                  ...(isMobile ? styles.mobileActionBtn : {}),
                  opacity: savingAnswers ? 0.6 : 1,
                }}
                disabled={savingAnswers}
              >
                {savingAnswers ? 'Saving...' : todaySubmission ? 'Update Answers' : 'Submit Checklist'}
              </button>
            </div>
          </section>
        ) : null}

        {!loading && viewMode === 'HISTORY' && selectedTemplate ? (
          <section style={{ ...styles.panel, ...(isMobile ? styles.panelMobile : {}) }}>
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
                        {templateTitleMap.get(submission.template_id) || 'Checklist'} - {formatDate(submission.submission_date)} - {formatDateTime(submission.created_at)}
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
          <section style={{ ...styles.panel, ...(isMobile ? styles.panelMobile : {}) }}>
            <div style={styles.ChecklistHeader}>
              <div>
                <div style={styles.sectionTitle}>
                  {templateTitleMap.get(viewingSubmission.template_id) || 'Submission'}
                </div>
                <div style={styles.ChecklistsubMeta}>
                  Submission by {viewingSubmission.submitted_by_name || viewingSubmission.submitted_by_email || '-'}
                </div>
                <div style={styles.ChecklistsubMeta}>
                  {formatDate(viewingSubmission.submission_date)} - {formatDateTime(viewingSubmission.created_at)}
                </div>
              </div>
            </div>

            <div style={styles.questionList}>
              {questions
                .filter((q) => q.template_id === viewingSubmission.template_id)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((question, index) => (
                  <div key={question.id} style={{ ...styles.questionCard, ...(isMobile ? styles.questionCardMobile : {}) }}>
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

                    {viewingAnswers[question.id]?.remark_text ? (
                      <div style={styles.viewRemarkBox}>
                        <div style={styles.viewRemarkLabel}>Remark</div>
                        <div>{viewingAnswers[question.id]?.remark_text}</div>
                      </div>
                    ) : null}
                  </div>
                ))}
            </div>

            <div style={{ ...styles.actionRow, ...(isMobile ? styles.actionRowMobile : {}) }}>
              <button
                type="button"
                onClick={() => setViewMode(submissionBackMode)}
                style={{ ...styles.secondaryBtn, ...(isMobile ? styles.mobileActionBtn : {}) }}
              >
                {submissionBackMode === 'LIST' ? 'Back to Checklists' : 'Back to History'}
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {showTemplateModal ? (
        <div style={{ ...styles.modalOverlay, ...(isMobile ? styles.modalOverlayMobile : {}) }}>
          <div
            style={{ ...styles.modalCard, ...(isMobile ? styles.modalCardMobile : {}) }}
            onClick={(e) => e.stopPropagation()}
          >
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
                x
              </button>
            </div>

            <div style={styles.ChecklistGroup}>
              <label style={styles.label}>Checklist Title</label>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                style={styles.input}
                placeholder="Example: Room Inspection"
                disabled={templateSaving}
              />
            </div>

            <div style={styles.createQuestionList}>
              {draftQuestions.map((question, index) => (
                <div
                  key={`${question.existingId || 'new'}-${index}`}
                  style={{ ...styles.createQuestionCard, ...(isMobile ? styles.createQuestionCardMobile : {}) }}
                >
                  <div style={styles.createQuestionHeader}>
                    <div style={styles.createQuestionTitle}>Question {index + 1}</div>
                    <div style={styles.questionHeaderActions}>
                      <button
                        type="button"
                        onClick={() => moveDraftQuestion(index, 'UP')}
                        style={{
                          ...styles.reorderBtn,
                          opacity: templateSaving || index === 0 ? 0.45 : 1,
                        }}
                        disabled={templateSaving || index === 0}
                        title="Move question up"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDraftQuestion(index, 'DOWN')}
                        style={{
                          ...styles.reorderBtn,
                          opacity: templateSaving || index === draftQuestions.length - 1 ? 0.45 : 1,
                        }}
                        disabled={templateSaving || index === draftQuestions.length - 1}
                        title="Move question down"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDraftQuestion(index)}
                        style={{
                          ...styles.removeBtn,
                          opacity: templateSaving ? 0.45 : 1,
                        }}
                        disabled={templateSaving}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div style={styles.ChecklistGroup}>
                    <label style={styles.label}>Question</label>
                    <input
                      value={question.question_text}
                      onChange={(e) => updateDraftQuestion(index, 'question_text', e.target.value)}
                      style={styles.input}
                      placeholder="Enter question"
                      disabled={templateSaving}
                    />
                  </div>

                  <div style={styles.ChecklistGroup}>
                    <label style={styles.label}>Description</label>
                    <textarea
                      value={question.question_description}
                      onChange={(e) =>
                        updateDraftQuestion(index, 'question_description', e.target.value)
                      }
                      style={{ ...styles.textareaCompact, ...(isMobile ? styles.textareaCompactMobile : {}) }}
                      placeholder="Optional description or guidance"
                      disabled={templateSaving}
                    />
                  </div>

                  <div style={styles.ChecklistGroup}>
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
                      Removing this question will also remove its saved answers from past Supervisor Checklist submissions.
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div style={{ ...styles.modalActionsSpread, ...(isMobile ? styles.actionRowMobile : {}) }}>
              <button
                type="button"
                onClick={addDraftQuestion}
                style={{ ...styles.secondaryBtn, ...(isMobile ? styles.mobileActionBtn : {}) }}
                disabled={templateSaving}
              >
                Add Question
              </button>

              <div style={{ ...styles.modalActions, ...(isMobile ? styles.modalActionsMobile : {}) }}>
                <button
                  type="button"
                  onClick={closeTemplateModal}
                  style={{ ...styles.secondaryBtn, ...(isMobile ? styles.mobileActionBtn : {}) }}
                  disabled={templateSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveTemplate()}
                  style={{
                    ...styles.primaryBtn,
                    ...(isMobile ? styles.mobileActionBtn : {}),
                    opacity: templateSaving ? 0.6 : 1,
                  }}
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
    background: 'linear-gradient(180deg, #f3f7ff 0%, #f8fafc 34%, #ffffff 100%)',
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
    background: 'rgba(255,255,255,0.9)',
    border: '1px solid #dbe7f7',
    borderRadius: '24px',
    padding: '18px 20px',
    boxShadow: '0 18px 42px rgba(37, 99, 235, 0.08)',
    marginBottom: '18px',
  },
  topBarMobile: {
    alignItems: 'stretch',
    borderRadius: '18px',
    padding: '16px',
  },
  topBarActions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  topBarActionsMobile: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr',
  },
  eyebrow: {
    fontSize: '11px',
    color: '#2563eb',
    fontWeight: 900,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '6px',
  },
  pageTitle: {
    fontSize: 'clamp(26px, 4vw, 36px)',
    fontWeight: 900,
    color: '#0f172a',
    lineHeight: 1.1,
  },
  pageSubTitle: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
  },
  panel: {
    background: 'rgba(255,255,255,0.92)',
    border: '1px solid #dbe7f7',
    borderRadius: '24px',
    padding: '20px',
    boxShadow: '0 18px 46px rgba(15,23,42,0.06)',
    marginBottom: '16px',
  },
  panelMobile: {
    borderRadius: '18px',
    padding: '14px',
  },
  sectionHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '14px',
  },
  sectionEyebrow: {
    fontSize: '11px',
    color: '#2563eb',
    fontWeight: 900,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '4px',
  },
  sectionHint: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '999px',
    padding: '7px 10px',
    fontSize: '12px',
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  sectionTitle: {
    fontSize: 'clamp(20px, 3vw, 26px)',
    fontWeight: 900,
    color: '#0f172a',
    marginBottom: '10px',
  },
  modeRow: {
    display: 'inline-flex',
    gap: '6px',
    flexWrap: 'wrap',
    background: '#eaf2ff',
    border: '1px solid #dbeafe',
    borderRadius: '999px',
    padding: '5px',
    marginBottom: '16px',
  },
  modeBtn: {
    border: '1px solid transparent',
    background: 'transparent',
    color: '#334155',
    borderRadius: '999px',
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  modeBtnActive: {
    background: '#ffffff',
    color: '#0f172a',
    borderColor: '#bfdbfe',
    boxShadow: '0 8px 18px rgba(37,99,235,0.12)',
  },
  mobileActionBtn: {
    width: '100%',
    minHeight: '46px',
  },
  mobileCompactBtn: {
    width: 'fit-content',
    minHeight: '40px',
    padding: '10px 13px',
    fontSize: '13px',
    justifySelf: 'start',
  },
  shiftCardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    alignItems: 'center',
    marginBottom: '14px',
  },
  shiftIcon: {
    width: '38px',
    height: '38px',
    borderRadius: '14px',
    background: '#eff6ff',
    color: '#2563eb',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    border: '1px solid #bfdbfe',
  },
  statusNeutral: {
    background: '#f8fafc',
    color: '#475569',
    border: '1px solid #e2e8f0',
  },
  headerRightMobile: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr',
  },
  actionRowMobile: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    width: '100%',
  },
  modalActionsMobile: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    width: '100%',
  },
  modalOverlayMobile: {
    alignItems: 'flex-end',
    padding: '10px',
  },
  modalCardMobile: {
    maxHeight: '92vh',
    borderRadius: '22px 22px 14px 14px',
    padding: '14px',
  },
  questionCardMobile: {
    padding: '13px',
    borderRadius: '16px',
  },
  createQuestionCardMobile: {
    padding: '12px',
    borderRadius: '16px',
  },
  textareaMobile: {
    minHeight: '86px',
  },
  textareaCompactMobile: {
    minHeight: '76px',
  },
  ChecklistCardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
  },
  ChecklistChooserCard: {
    border: '1px solid #dbe7f7',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    color: '#0f172a',
    borderRadius: '18px',
    padding: '16px',
    textAlign: 'left',
    boxShadow: '0 12px 26px rgba(15,23,42,0.045)',
  },
  ChecklistChooserCardActive: {
    borderColor: '#60a5fa',
    boxShadow: '0 16px 34px rgba(37,99,235,0.14)',
  },
  ChecklistChooserTitle: {
    fontSize: '18px',
    fontWeight: 900,
    marginBottom: '8px',
  },
  ChecklistChooserMeta: {
    fontSize: '14px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: '16px',
  },
  ChecklistChooserHint: {
    fontSize: '13px',
    color: '#2563eb',
    fontWeight: 900,
  },
  cardActionRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  cardOpenBtn: {
    border: '0',
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '10px 12px',
    fontSize: '13px',
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 10px 22px rgba(37,99,235,0.18)',
  },
  cardDeleteBtn: {
    border: '1px solid #fecaca',
    background: '#fff5f5',
    color: '#dc2626',
    borderRadius: '12px',
    padding: '10px 12px',
    fontSize: '13px',
    fontWeight: 900,
    cursor: 'pointer',
  },
  ChecklistHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  ChecklistHeaderRight: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  ChecklistsubMeta: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '6px',
    fontWeight: 700,
  },
  trackerPanel: {
    border: '1px solid #dbe7f7',
    background: 'linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)',
    borderRadius: '18px',
    padding: '14px',
    marginBottom: '14px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.035)',
  },
  trackerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  trackerTitle: {
    fontSize: '18px',
    fontWeight: 900,
    color: '#0f172a',
  },
  trackerDate: {
    border: '1px solid #dbe7f7',
    background: '#ffffff',
    borderRadius: '999px',
    padding: '8px 11px',
    fontSize: '12px',
    fontWeight: 900,
    color: '#475569',
  },
  trackerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: '10px',
  },
  trackerCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    padding: '12px',
    display: 'grid',
    gap: '9px',
    width: '100%',
    textAlign: 'left',
    font: 'inherit',
  },
  trackerCardSubmitted: {
    background: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  trackerCardPending: {
    background: '#fff7ed',
    borderColor: '#fed7aa',
  },
  trackerUser: {
    display: 'flex',
    gap: '9px',
    alignItems: 'center',
    minWidth: 0,
  },
  trackerDotSubmitted: {
    width: '10px',
    height: '10px',
    borderRadius: '999px',
    background: '#16a34a',
    flex: '0 0 auto',
  },
  trackerDotPending: {
    width: '10px',
    height: '10px',
    borderRadius: '999px',
    background: '#f97316',
    flex: '0 0 auto',
  },
  trackerName: {
    fontSize: '14px',
    fontWeight: 900,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  trackerEmail: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#64748b',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  trackerStatusSubmitted: {
    width: 'fit-content',
    borderRadius: '999px',
    padding: '7px 10px',
    fontSize: '12px',
    fontWeight: 900,
    color: '#166534',
    background: '#dcfce7',
  },
  trackerStatusPending: {
    width: 'fit-content',
    borderRadius: '999px',
    padding: '7px 10px',
    fontSize: '12px',
    fontWeight: 900,
    color: '#c2410c',
    background: '#ffedd5',
  },
  trackerTime: {
    fontSize: '12px',
    fontWeight: 800,
    color: '#475569',
  },
  trackerEmpty: {
    border: '1px dashed #bfdbfe',
    background: '#f8fbff',
    borderRadius: '14px',
    padding: '12px',
    fontSize: '13px',
    lineHeight: 1.5,
    fontWeight: 800,
    color: '#475569',
  },
  statusPill: {
    borderRadius: '999px',
    padding: '8px 11px',
    fontSize: '12px',
    fontWeight: 900,
  },
  statusPending: {
    background: '#fff7ed',
    color: '#c2410c',
    border: '1px solid #fed7aa',
  },
  statusSubmitted: {
    background: '#ecfdf5',
    color: '#166534',
    border: '1px solid #bbf7d0',
  },
  questionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  questionCard: {
    border: '1px solid #dbe7f7',
    background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 10px 24px rgba(15,23,42,0.035)',
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
    fontSize: '17px',
    fontWeight: 900,
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
    border: '1px solid #dbe7f7',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '12px',
    padding: '12px 18px',
    fontWeight: 900,
    cursor: 'pointer',
    minWidth: '110px',
  },
  answerChoiceBtnActive: {
    background: '#2563eb',
    color: '#ffffff',
    borderColor: '#2563eb',
    boxShadow: '0 10px 22px rgba(37,99,235,0.18)',
  },
  remarkArea: {
    marginTop: '12px',
  },
  addRemarkBtn: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '999px',
    padding: '8px 11px',
    fontWeight: 900,
    fontSize: '12px',
    cursor: 'pointer',
  },
  remarkTextarea: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: '72px',
    border: '1px solid #bfdbfe',
    background: '#f8fbff',
    color: '#0f172a',
    borderRadius: '14px',
    padding: '11px 13px',
    fontSize: '14px',
    outline: 'none',
    resize: 'vertical',
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
  viewRemarkBox: {
    marginTop: '10px',
    border: '1px solid #bfdbfe',
    background: '#f8fbff',
    borderRadius: '14px',
    padding: '11px 13px',
    color: '#334155',
    fontWeight: 700,
    whiteSpace: 'pre-wrap',
  },
  viewRemarkLabel: {
    color: '#2563eb',
    fontSize: '12px',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '5px',
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
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 12px 24px rgba(37,99,235,0.24)',
  },
  primaryBtn: {
    border: 'none',
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    color: '#ffffff',
    borderRadius: '14px',
    padding: '12px 16px',
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 12px 24px rgba(37,99,235,0.22)',
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
    fontWeight: 900,
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
  questionHeaderActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  reorderBtn: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    borderRadius: '12px',
    padding: '10px 12px',
    fontWeight: 800,
    cursor: 'pointer',
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
  ChecklistGroup: {
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

