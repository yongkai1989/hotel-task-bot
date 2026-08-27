'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createBrowserSupabaseClient } from '../../../lib/supabaseBrowser';
import styles from '../hk-schedule/schedule.module.css';

type EntryStatus = 'WORK' | 'AL' | 'UPL' | 'NO_SHOW' | 'MC' | 'OFF';
type StaffRole = 'MANAGER' | 'FRONT_OFFICE' | 'NIGHT_AUDITOR' | 'RESERVATIONS';
type ShiftPreference = 'FLEX' | 'MORNING' | 'AFTERNOON' | 'NIGHT' | 'RESERVATIONS';
type StaffGender = 'MALE' | 'FEMALE';
type ShiftColor = 'BLUE' | 'TEAL' | 'PURPLE' | 'AMBER' | 'PINK' | 'SLATE';

type Profile = { user_id:string; email:string; name:string; role:string; can_access_fo_schedule:boolean; fo_schedule_view_only:boolean };
type Staff = { id:string; staff_name:string; staff_role:StaffRole; staff_gender:StaffGender|null; fixed_off_day:number|null; preferred_shift:ShiftPreference; is_permanent_night:boolean; is_hybrid_night:boolean; is_manager:boolean; is_active:boolean; sort_order:number };
type Shift = { id:string; shift_name:string; shift_code:string; start_time:string; end_time:string; color:ShiftColor; is_active:boolean };
type Entry = { id:string; staff_id:string; schedule_date:string; status:EntryStatus; shift_id:string|null; shift_name_snapshot:string|null; shift_code_snapshot:string|null; scheduled_start:string|null; scheduled_end:string|null; is_late:boolean; overtime_minutes:number; notes:string|null; auto_filled:boolean; compliance_exception:boolean; updated_by_name:string; updated_at:string };

const STATUS_OPTIONS:Array<{value:EntryStatus;label:string;short:string}> = [
  {value:'WORK',label:'Working shift',short:'Work'}, {value:'AL',label:'Annual Leave',short:'AL'},
  {value:'UPL',label:'Unpaid Leave',short:'UPL'}, {value:'NO_SHOW',label:'No Show',short:'NS'},
  {value:'MC',label:'Medical Certificate',short:'MC'}, {value:'OFF',label:'Off Day',short:'Off'},
];
const ROLES:Array<{value:StaffRole;label:string}> = [
  {value:'MANAGER',label:'Manager'}, {value:'NIGHT_AUDITOR',label:'Night Auditor'},
  {value:'RESERVATIONS',label:'Reservations'}, {value:'FRONT_OFFICE',label:'Front Office'},
];
const PREFERENCES:Array<{value:ShiftPreference;label:string}> = [
  {value:'FLEX',label:'Flexible'}, {value:'MORNING',label:'Permanent Morning'},
  {value:'AFTERNOON',label:'Permanent Afternoon'}, {value:'NIGHT',label:'Night'},
  {value:'RESERVATIONS',label:'Reservations'},
];
const WEEKDAYS = [{value:1,label:'Mon'},{value:2,label:'Tue'},{value:3,label:'Wed'},{value:4,label:'Thu'},{value:5,label:'Fri'},{value:6,label:'Sat'},{value:7,label:'Sun'}];
const TARGETS:Record<string,number> = { MORNING:2, AFTERNOON:2, NIGHT:2, RESERVATIONS:1 };

function pad(value:number){ return String(value).padStart(2,'0'); }
function dateKey(date:Date){ return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function monthKey(date=new Date()){ return `${date.getFullYear()}-${pad(date.getMonth()+1)}`; }
function addMonths(value:string,amount:number){ const [y,m]=value.split('-').map(Number); return monthKey(new Date(y,m-1+amount,1)); }
function monthBounds(value:string){ const [y,m]=value.split('-').map(Number); const end=new Date(y,m,0); return {start:`${value}-01`,end:dateKey(end),days:end.getDate()}; }
function displayDate(value:string){ return new Intl.DateTimeFormat('en-MY',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${value}T00:00:00`)); }
function timeText(value:string|null){ if(!value)return ''; const [h,m]=value.slice(0,5).split(':').map(Number); return `${h%12||12}:${pad(m)} ${h>=12?'PM':'AM'}`; }
function durationText(total:number){ const h=Math.floor(total/60),m=total%60; return `${h?`${h} hr `:''}${m?`${m} min`:h?'':'0 min'}`.trim(); }
function previousDate(value:string){ const date=new Date(`${value}T00:00:00`); date.setDate(date.getDate()-1); return dateKey(date); }
function shiftCode(entry:Entry|null|undefined){ return String(entry?.shift_code_snapshot||'').toUpperCase(); }
function getSupabaseSafe(){ try{return createBrowserSupabaseClient();}catch{return null;} }

export default function FrontOfficeSchedulePage(){
  const supabase=useMemo(()=>getSupabaseSafe(),[]);
  const [profile,setProfile]=useState<Profile|null>(null);
  const [authLoading,setAuthLoading]=useState(true),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[success,setSuccess]=useState('');
  const [month,setMonth]=useState(monthKey()),[half,setHalf]=useState<'FULL'|'FIRST'|'SECOND'>('FIRST');
  const [tab,setTab]=useState<'SCHEDULE'|'REPORT'>('SCHEDULE');
  const [staff,setStaff]=useState<Staff[]>([]),[shifts,setShifts]=useState<Shift[]>([]),[entries,setEntries]=useState<Entry[]>([]);
  const [cell,setCell]=useState<{staff:Staff;date:string;entry:Entry|null}|null>(null);
  const [staffOpen,setStaffOpen]=useState(false),[bulkStaff,setBulkStaff]=useState<Staff|null>(null);
  const canAccess=!!profile&&(profile.role.toUpperCase()==='SUPERUSER'||profile.can_access_fo_schedule);
  const canEdit=canAccess&&!!profile&&!profile.fo_schedule_view_only;

  useEffect(()=>{ let active=true; (async()=>{ try{
    if(!supabase)throw new Error('Supabase is not configured');
    const {data:{session},error:sessionError}=await supabase.auth.getSession(); if(sessionError)throw sessionError;
    if(!session?.user)throw new Error('Please sign in to continue');
    const {data,error:profileError}=await supabase.from('user_profiles').select('user_id,email,name,role,can_access_fo_schedule,fo_schedule_view_only').eq('user_id',session.user.id).single();
    if(profileError)throw profileError; if(active)setProfile(data as Profile);
  }catch(err:any){if(active)setError(err?.message||'Unable to verify access');}finally{if(active)setAuthLoading(false);}})(); return()=>{active=false;}; },[supabase]);

  const bounds=useMemo(()=>monthBounds(month),[month]);
  const loadData=useCallback(async()=>{ if(!supabase||!canAccess){setLoading(false);return;} setLoading(true);setError('');
    const [a,b,c]=await Promise.all([
      supabase.from('fo_schedule_staff').select('*').order('sort_order').order('staff_name'),
      supabase.from('fo_schedule_shifts').select('*').order('start_time'),
      supabase.from('fo_schedule_entries').select('*').gte('schedule_date',bounds.start).lte('schedule_date',bounds.end).order('schedule_date'),
    ]);
    const issue=a.error||b.error||c.error; if(issue)setError(issue.message); else{setStaff((a.data||[]) as Staff[]);setShifts((b.data||[]) as Shift[]);setEntries((c.data||[]) as Entry[]);} setLoading(false);
  },[bounds.end,bounds.start,canAccess,supabase]);
  useEffect(()=>{if(!supabase||!canAccess)return; if(canEdit)void supabase.rpc('cleanup_fo_schedule_history').then(()=>loadData()); else void loadData();},[canAccess,canEdit,loadData,supabase]);

  const entryMap=useMemo(()=>new Map(entries.map(entry=>[`${entry.staff_id}:${entry.schedule_date}`,entry])),[entries]);
  const days=useMemo(()=>Array.from({length:bounds.days},(_,i)=>{const value=`${month}-${pad(i+1)}`;const date=new Date(`${value}T00:00:00`);return{value,day:i+1,weekday:new Intl.DateTimeFormat('en-MY',{weekday:'short'}).format(date).slice(0,2),weekend:[0,6].includes(date.getDay()),today:value===dateKey(new Date())};}).filter(day=>half==='FULL'||(half==='FIRST'?day.day<=15:day.day>=16)),[bounds.days,half,month]);
  const activeStaff=useMemo(()=>staff.filter(person=>person.is_active),[staff]);
  const jtkExceptions=useMemo(()=>new Set(entries.filter(entry=>entry.status==='WORK'&&shiftCode(entry)==='MORNING'&&shiftCode(entryMap.get(`${entry.staff_id}:${previousDate(entry.schedule_date)}`))==='AFTERNOON').map(entry=>`${entry.staff_id}:${entry.schedule_date}`)),[entries,entryMap]);
  const coverage=useMemo(()=>days.map(day=>{
    const counts:Record<string,number>={MORNING:0,AFTERNOON:0,NIGHT:0,RESERVATIONS:0,MID:0,MANAGER:0};
    const nightNames:string[]=[];
    let nightMale=0;
    for(const person of activeStaff){
      const entry=entryMap.get(`${person.id}:${day.value}`);
      if(entry?.status!=='WORK')continue;
      const code=shiftCode(entry);
      counts[code]=(counts[code]||0)+1;
      if(code==='NIGHT'){
        nightNames.push(person.staff_name.trim().toLowerCase());
        if(person.staff_gender==='MALE')nightMale+=1;
      }
    }
    const shortages=Object.entries(TARGETS).filter(([code,target])=>(counts[code]||0)<target).map(([code,target])=>`${code} ${counts[code]||0}/${target}`);
    if((counts.NIGHT||0)>0&&nightMale===0)shortages.push('NIGHT male 0/1');
    if(nightNames.includes('jia')&&(!nightNames.some(name=>name==='harish'||name==='zaim')||nightNames.includes('saravanan'))){
      shortages.push('JIA must pair with Harish or Zaim');
    }
    return{date:day.value,counts,nightMale,shortages};
  }),[activeStaff,days,entryMap]);
  const coverageMap=useMemo(()=>new Map(coverage.map(item=>[item.date,item])),[coverage]);
  const shortageDays=coverage.filter(item=>item.shortages.length);
  const reportRows=useMemo(()=>activeStaff.map(person=>{const rows=entries.filter(e=>e.staff_id===person.id);return{person,work:rows.filter(e=>e.status==='WORK').length,noShow:rows.filter(e=>e.status==='NO_SHOW').length,late:rows.filter(e=>e.is_late).length,ot:rows.reduce((n,e)=>n+e.overtime_minutes,0),al:rows.filter(e=>e.status==='AL').length,upl:rows.filter(e=>e.status==='UPL').length,mc:rows.filter(e=>e.status==='MC').length,off:rows.filter(e=>e.status==='OFF').length};}),[activeStaff,entries]);

  function flash(message:string){setSuccess(message);setError('');window.setTimeout(()=>setSuccess(''),3500);}
  async function autoFill(){ if(!supabase||!canEdit)return; const hybrids=activeStaff.filter(s=>s.is_hybrid_night); const permanent=activeStaff.find(s=>s.is_permanent_night);
    if(!permanent||!hybrids.length){setError('Set Saravanan/permanent Night Auditor and choose at least one Hybrid Night staff member under Staff before Auto Fill.');return;}
    const missingGender=activeStaff.filter(person=>!person.staff_gender);if(missingGender.length){setError(`Set Male or Female for every active staff member before Auto Fill: ${missingGender.map(person=>person.staff_name).join(', ')}.`);return;}
    if(!window.confirm(`Fill only empty dates in ${new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric'}).format(new Date(`${month}-01T00:00:00`))}?\n\nManual entries will not be changed. Night coverage is filled first. Jia will only pair with Harish or Zaim. Walter remains on Manager 9:00 AM–5:00 PM unless minimum shift coverage requires him. Extra staff go to Mid.`))return;
    setBusy(true); const {data,error:fillError}=await supabase.rpc('autofill_fo_schedule_month',{p_month:`${month}-01`}); setBusy(false);
    if(fillError){setError(fillError.message);return;} const result=(data||{}) as any;
    flash(`${Number(result.inserted||0)} empty dates filled. ${Number(result.exceptions||0)} JTK exception(s), ${Number(result.shortages||0)} uncovered position(s).`); await loadData();
  }

  if(authLoading)return <PageState title="Checking access..."/>;
  if(!profile||!canAccess)return <PageState title="Front Office Schedule" message={error||'You do not have access to this page.'}/>;
  return <main className={styles.page}>
    <section className={styles.hero}><div><span className={styles.eyebrow}>FRONT OFFICE WORKFORCE</span><h1>Front Office Schedule</h1><p>Night-first monthly roster with coverage targets and JTK rest checks.</p></div>
      {canEdit?<div className={styles.heroActions}><button className={styles.autoFillButton} disabled={busy||!activeStaff.length} onClick={()=>void autoFill()}>{busy?'Filling...':'⚡ Fill Empty Shifts'}</button><button className={styles.secondaryButton} onClick={()=>setStaffOpen(true)}>Staff & night setup</button></div>:<span className={styles.viewOnlyBadge}>View only</span>}
    </section>
    {error?<div className={styles.error}>{error}</div>:null}{success?<div className={styles.success}>{success}</div>:null}
    <section className={styles.toolbar}><div className={styles.tabs}><button className={tab==='SCHEDULE'?styles.activeTab:''} onClick={()=>setTab('SCHEDULE')}>Schedule</button><button className={tab==='REPORT'?styles.activeTab:''} onClick={()=>setTab('REPORT')}>Report</button></div><div className={styles.dateControls}>
      {tab==='SCHEDULE'?<div className={styles.halfButtons}><button className={half==='FIRST'?styles.selected:''} onClick={()=>setHalf(half==='FIRST'?'FULL':'FIRST')}>First Half</button><button className={half==='SECOND'?styles.selected:''} onClick={()=>setHalf(half==='SECOND'?'FULL':'SECOND')}>Second Half</button></div>:null}
      <div className={styles.monthControl}><button onClick={()=>setMonth(addMonths(month,-1))}>‹</button><input type="month" value={month} min={addMonths(monthKey(),-6)} max={addMonths(monthKey(),12)} onChange={e=>setMonth(e.target.value||monthKey())}/><button onClick={()=>setMonth(addMonths(month,1))}>›</button></div></div></section>
    {tab==='SCHEDULE'?<>
      <section className={styles.legend}><span><i className={styles.workDot}/> Work</span><span><i className={styles.alDot}/> AL</span><span><i className={styles.uplDot}/> UPL</span><span><i className={styles.mcDot}/> MC</span><span><i className={styles.offDot}/> Off</span><span><i className={styles.noShowDot}/> No Show</span><span className={styles.staffCount}>{activeStaff.length} staff</span><small>Yellow = Afternoon followed by next-day Morning. Red date = insufficient coverage, no male on Night, or Jia is not paired with Harish/Zaim.</small></section>
      {shortageDays.length?<section className={styles.error}><strong>{shortageDays.length} day{shortageDays.length===1?'':'s'} below target:</strong> {shortageDays.slice(0,8).map(item=>`${displayDate(item.date)} (${item.shortages.join(', ')})`).join(' · ')}{shortageDays.length>8?' …':''}</section>:<div className={styles.success}>All visible dates meet the 2 Morning · 2 Afternoon · 2 Night · 1 Reservations target.</div>}
      <section className={styles.scheduleCard}>{loading?<PageState title="Loading timetable..." compact/>:<div className={styles.gridWrap}><table className={styles.scheduleTable}><thead><tr><th className={styles.staffColumn}>Staff member</th>{days.map(day=><th key={day.value} className={`${day.weekend?styles.weekend:''} ${day.today?styles.today:''} ${coverageMap.get(day.value)?.shortages.length?styles.foCoverageShortage:''}`} title={coverageMap.get(day.value)?.shortages.join(', ')}><span>{day.weekday}</span>{day.day}</th>)}</tr></thead><tbody>
        {ROLES.flatMap(role=>{const people=activeStaff.filter(person=>person.staff_role===role.value);if(!people.length)return[];return[<tr className={styles.roleDivider} key={`role-${role.value}`}><th className={styles.staffColumn}>{role.label}</th><td colSpan={days.length}/></tr>,...people.map(person=><tr key={person.id}><th className={styles.staffColumn}><strong>{person.staff_name}</strong>{person.is_permanent_night?<small>Permanent Night</small>:person.is_hybrid_night?<small>Hybrid Night</small>:person.preferred_shift!=='FLEX'?<small>{person.preferred_shift}</small>:null}{canEdit?<button onClick={()=>setBulkStaff(person)}>Fill dates</button>:null}</th>{days.map(day=>{const entry=entryMap.get(`${person.id}:${day.value}`)||null;const jtk=jtkExceptions.has(`${person.id}:${day.value}`);return <td key={day.value} className={day.weekend?styles.weekend:''}><button disabled={!canEdit} className={`${styles.dayCell} ${entry?styles[`status_${entry.status}`]:''} ${entry?.is_late?styles.lateDay:''} ${jtk?styles.foJtkException:''}`} title={jtk?'JTK exception: Afternoon followed by Morning':entry?`${entry.shift_name_snapshot||entry.status}${entry.notes?` · ${entry.notes}`:''}`:`Schedule ${person.staff_name}`} onClick={()=>canEdit&&setCell({staff:person,date:day.value,entry})}><strong>{entry?entry.status==='WORK'?(entry.shift_code_snapshot||'Work'):STATUS_OPTIONS.find(x=>x.value===entry.status)?.short:'+'}</strong>{jtk?<small>REST</small>:entry?.is_late?<small>LATE</small>:entry?.auto_filled?<small>AUTO</small>:null}</button></td>;})}</tr>)];})}
      </tbody></table></div>}</section>
    </>:<section className={styles.reportArea}><div className={styles.summaryGrid}><SummaryCard label="JTK rest exceptions" value={`${jtkExceptions.size}`} tone="amber"/><SummaryCard label="Coverage shortage days" value={`${coverage.filter(x=>x.shortages.length).length}`} tone="red"/><SummaryCard label="Active staff" value={`${activeStaff.length}`} tone="blue"/></div><div className={styles.reportTableWrap}><table className={styles.reportTable}><thead><tr><th>Staff</th><th>Work</th><th>No Show</th><th>Late</th><th>Total OT</th><th>AL</th><th>UPL</th><th>MC</th><th>Off</th></tr></thead><tbody>{reportRows.map(row=><tr key={row.person.id}><th>{row.person.staff_name}<small className={styles.reportRole}>{ROLES.find(x=>x.value===row.person.staff_role)?.label}</small></th><td>{row.work}</td><td className={row.noShow?styles.dangerValue:''}>{row.noShow}</td><td className={row.late?styles.warningValue:''}>{row.late}</td><td>{durationText(row.ot)}</td><td>{row.al}</td><td>{row.upl}</td><td>{row.mc}</td><td>{row.off}</td></tr>)}</tbody></table></div></section>}
    {cell?<EntryModal selection={cell} shifts={shifts} busy={busy} onClose={()=>setCell(null)} onSave={async form=>{if(!supabase)return;setBusy(true);const {error:e}=await supabase.rpc('save_fo_schedule_entry',{p_staff_id:cell.staff.id,p_schedule_date:cell.date,p_status:form.status,p_shift_id:form.status==='WORK'&&!form.custom?form.shiftId:null,p_overtime_minutes:form.status==='WORK'?form.ot:0,p_notes:form.notes||null,p_custom_start:form.status==='WORK'&&form.custom?form.start:null,p_custom_end:form.status==='WORK'&&form.custom?form.end:null,p_is_late:form.status==='WORK'&&form.late});setBusy(false);if(e){setError(e.message);return;}setCell(null);flash('Schedule saved.');await loadData();}} onClear={async()=>{if(!supabase)return;setBusy(true);const{error:e}=await supabase.rpc('delete_fo_schedule_entry',{p_staff_id:cell.staff.id,p_schedule_date:cell.date});setBusy(false);if(e){setError(e.message);return;}setCell(null);flash('Entry cleared.');await loadData();}}/>:null}
    {staffOpen?<StaffModal staff={staff} busy={busy} onClose={()=>setStaffOpen(false)} onSave={async(person,form)=>{if(!supabase)return;setBusy(true);const{error:e}=await supabase.rpc('save_fo_schedule_staff',{p_staff_id:person?.id||null,p_staff_name:form.name,p_staff_role:form.role,p_fixed_off_day:form.off,p_preferred_shift:form.preference,p_is_permanent_night:form.permanent,p_is_hybrid_night:form.hybrid,p_is_manager:form.manager,p_is_active:form.active,p_staff_gender:form.gender||null});setBusy(false);if(e){setError(e.message);return;}flash(person?'Staff updated.':'Staff added.');await loadData();}} onDelete={async person=>{if(!supabase||!window.confirm(`Remove ${person.staff_name}? History will be retained.`))return;setBusy(true);const{error:e}=await supabase.rpc('delete_fo_schedule_staff',{p_staff_id:person.id});setBusy(false);if(e){setError(e.message);return;}flash('Staff removed.');await loadData();}}/>:null}
    {bulkStaff?<BulkModal staff={bulkStaff} month={month} shifts={shifts} busy={busy} onClose={()=>setBulkStaff(null)} onSave={async form=>{if(!supabase)return;setBusy(true);const{data,error:e}=await supabase.rpc('fill_fo_schedule_range',{p_staff_id:bulkStaff.id,p_start_date:form.start,p_end_date:form.end,p_weekdays:form.weekdays,p_status:form.status,p_shift_id:form.status==='WORK'?form.shiftId:null,p_apply_fixed_off:form.fixed});setBusy(false);if(e){setError(e.message);return;}setBulkStaff(null);flash(`${Number(data||0)} dates filled.`);await loadData();}}/>:null}
  </main>;
}

function PageState({title,message,compact=false}:{title:string;message?:string;compact?:boolean}){return <div className={`${styles.pageState} ${compact?styles.compactState:''}`}><strong>{title}</strong>{message?<p>{message}</p>:null}</div>;}
function SummaryCard({label,value,tone}:{label:string;value:string;tone:'red'|'amber'|'blue'}){return <article className={`${styles.summaryCard} ${styles[`summary_${tone}`]}`}><span>{label}</span><strong>{value}</strong></article>;}
function ModalShell({title,subtitle,children,onClose}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void}){return <div className={styles.modalBackdrop} onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className={styles.modal} role="dialog" aria-modal="true"><header><div><h2>{title}</h2>{subtitle?<p>{subtitle}</p>:null}</div><button onClick={onClose}>×</button></header>{children}</section></div>;}

function EntryModal({selection,shifts,busy,onClose,onSave,onClear}:{selection:{staff:Staff;date:string;entry:Entry|null};shifts:Shift[];busy:boolean;onClose:()=>void;onSave:(form:{status:EntryStatus;shiftId:string;custom:boolean;start:string;end:string;late:boolean;ot:number;notes:string})=>void;onClear:()=>void}){
  const active=shifts.filter(s=>s.is_active||s.id===selection.entry?.shift_id);const [status,setStatus]=useState<EntryStatus>(selection.entry?.status||'WORK'),[shiftId,setShiftId]=useState(selection.entry?.shift_id||active[0]?.id||''),[custom,setCustom]=useState(selection.entry?.status==='WORK'&&!selection.entry.shift_id),[start,setStart]=useState(selection.entry?.scheduled_start?.slice(0,5)||'07:00'),[end,setEnd]=useState(selection.entry?.scheduled_end?.slice(0,5)||'15:30'),[late,setLate]=useState(!!selection.entry?.is_late),[ot,setOt]=useState(String(selection.entry?.overtime_minutes||'')),[notes,setNotes]=useState(selection.entry?.notes||'');
  return <ModalShell title={selection.staff.staff_name} subtitle={displayDate(selection.date)} onClose={onClose}><div className={styles.modalBody}><label>Work status</label><div className={styles.statusPicker}>{STATUS_OPTIONS.map(x=><button key={x.value} className={`${styles[`status_${x.value}`]} ${status===x.value?styles.statusSelected:''}`} onClick={()=>setStatus(x.value)}>{x.short}<small>{x.label}</small></button>)}</div>{status==='WORK'?<><label>Scheduled shift</label><div className={styles.scheduleMode}><button className={!custom?styles.selected:''} onClick={()=>setCustom(false)}>Saved shift</button><button className={custom?styles.selected:''} onClick={()=>setCustom(true)}>Ad hoc hours</button></div>{custom?<div className={styles.customHours}><div><label>Starts</label><input type="time" value={start} onChange={e=>setStart(e.target.value)}/></div><span>to</span><div><label>Ends</label><input type="time" value={end} onChange={e=>setEnd(e.target.value)}/></div></div>:<select value={shiftId} onChange={e=>setShiftId(e.target.value)}><option value="">Choose shift</option>{active.map(s=><option key={s.id} value={s.id}>{s.shift_name} ({timeText(s.start_time)} – {timeText(s.end_time)})</option>)}</select>}<div className={styles.entryWorkDetails}><div><label>Attendance</label><div className={styles.attendanceToggle}><button className={`${styles.attendanceChoice} ${!late?styles.onTimeSelected:''}`} onClick={()=>setLate(false)}>✓ On time</button><button className={`${styles.attendanceChoice} ${late?styles.lateSelected:''}`} onClick={()=>setLate(true)}>! Late</button></div></div><div><label>Overtime (minutes)</label><input type="number" min="0" max="1440" step="15" value={ot} onChange={e=>setOt(e.target.value)}/></div></div></>:null}<label>Notes (optional)</label><textarea rows={2} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)}/></div><footer className={styles.modalFooter}>{selection.entry?<button className={styles.dangerButton} disabled={busy} onClick={onClear}>Clear</button>:<span/>}<div><button className={styles.secondaryButton} onClick={onClose}>Cancel</button><button className={styles.primaryButton} disabled={busy||(status==='WORK'&&(custom?(!start||!end):!shiftId))} onClick={()=>onSave({status,shiftId,custom,start,end,late,ot:Number(ot||0),notes})}>{busy?'Saving...':'Save'}</button></div></footer></ModalShell>;
}

type StaffForm={name:string;role:StaffRole;gender:StaffGender|'';off:number|null;preference:ShiftPreference;permanent:boolean;hybrid:boolean;manager:boolean;active:boolean};
function StaffModal({staff,busy,onClose,onSave,onDelete}:{staff:Staff[];busy:boolean;onClose:()=>void;onSave:(person:Staff|null,form:StaffForm)=>void;onDelete:(person:Staff)=>void}){
  const blank:StaffForm={name:'',role:'FRONT_OFFICE',gender:'',off:null,preference:'FLEX',permanent:false,hybrid:false,manager:false,active:true};const [form,setForm]=useState<StaffForm>(blank);
  const submit=(person:Staff|null,next:StaffForm)=>onSave(person,next);
  return <ModalShell title="Front Office staff & night setup" subtitle="Set each person's role, gender, preferred shift and fixed off day. Select any number of Hybrid Night staff." onClose={onClose}>
    <div className={`${styles.modalBody} ${styles.foStaffBody}`}>
      <section className={styles.foStaffAddSection} aria-labelledby="fo-add-staff-title">
        <div className={styles.foStaffSectionHeading}>
          <div><span>New staff member</span><h3 id="fo-add-staff-title">Add to Front Office schedule</h3></div>
          <small>All fields can be changed later.</small>
        </div>
        <div className={styles.foStaffAddGrid}>
          <label className={styles.foStaffNameField}>Full name<input placeholder="Enter staff name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
          <label>Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value as StaffRole})}>{ROLES.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
          <label>Gender<select value={form.gender} onChange={e=>setForm({...form,gender:e.target.value as StaffGender|''})}><option value="">Select gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select></label>
          <label>Preferred shift<select value={form.preference} onChange={e=>setForm({...form,preference:e.target.value as ShiftPreference})}>{PREFERENCES.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
          <label>Fixed off day<select value={form.off||''} onChange={e=>setForm({...form,off:e.target.value?Number(e.target.value):null})}><option value="">No fixed off day</option>{WEEKDAYS.map(x=><option key={x.value} value={x.value}>Every {x.label}</option>)}</select></label>
          <button className={`${styles.primaryButton} ${styles.foAddStaffButton}`} disabled={busy||!form.name.trim()||!form.gender} onClick={()=>{submit(null,{...form,name:form.name.trim()});setForm(blank);}}>+ Add staff</button>
        </div>
      </section>

      <div className={`${styles.infoBox} ${styles.foStaffRuleNote}`}><strong>Night shift safety rule</strong><span>Every active staff member needs a gender before Auto Fill. Each Night shift must include at least one male. Auto Fill never changes a saved cell.</span></div>

      <section className={styles.foStaffList} aria-label="Front Office staff setup">
        {staff.map(person=>{const value:StaffForm={name:person.staff_name,role:person.staff_role,gender:person.staff_gender||'',off:person.fixed_off_day,preference:person.preferred_shift,permanent:person.is_permanent_night,hybrid:person.is_hybrid_night,manager:person.is_manager,active:person.is_active};return <article className={styles.foStaffCard} key={person.id}>
          <header className={styles.foStaffCardHeader}>
            <div><h3>{person.staff_name}</h3><p>{ROLES.find(x=>x.value===person.staff_role)?.label}{person.is_permanent_night?' · Permanent Night Auditor':''}{person.is_hybrid_night?' · Hybrid Night':''}</p></div>
            <span className={person.is_active?styles.foActiveBadge:styles.foInactiveBadge}>{person.is_active?'Active':'Inactive'}</span>
          </header>
          <div className={styles.foStaffControlGrid}>
            <label>Gender<select value={person.staff_gender||''} disabled={busy} onChange={e=>submit(person,{...value,gender:e.target.value as StaffGender|''})}><option value="">Set gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select></label>
            <label>Preferred shift<select value={person.preferred_shift} disabled={busy} onChange={e=>submit(person,{...value,preference:e.target.value as ShiftPreference})}>{PREFERENCES.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
            <label>Fixed off day<select value={person.fixed_off_day||''} disabled={busy} onChange={e=>submit(person,{...value,off:e.target.value?Number(e.target.value):null})}><option value="">No fixed off</option>{WEEKDAYS.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
          </div>
          <div className={styles.foStaffCardActions}>
            <button className={person.is_hybrid_night?styles.primaryButton:styles.secondaryButton} disabled={busy||person.is_permanent_night} onClick={()=>submit(person,{...value,hybrid:!person.is_hybrid_night})}>{person.is_hybrid_night?'✓ Hybrid Night':'Set as Hybrid Night'}</button>
            {!person.is_active?<button className={styles.secondaryButton} disabled={busy} onClick={()=>submit(person,{...value,active:true})}>Restore staff</button>:null}
            <button className={styles.dangerOutline} disabled={busy} onClick={()=>onDelete(person)}>Delete</button>
          </div>
        </article>;})}
      </section>
    </div>
  </ModalShell>;
}

function BulkModal({staff,month,shifts,busy,onClose,onSave}:{staff:Staff;month:string;shifts:Shift[];busy:boolean;onClose:()=>void;onSave:(form:{start:string;end:string;weekdays:number[];status:EntryStatus;shiftId:string;fixed:boolean})=>void}){const bounds=monthBounds(month),active=shifts.filter(x=>x.is_active);const[start,setStart]=useState(bounds.start),[end,setEnd]=useState(bounds.end),[weekdays,setWeekdays]=useState([1,2,3,4,5,6,7]),[status,setStatus]=useState<EntryStatus>('WORK'),[shiftId,setShiftId]=useState(active[0]?.id||''),[fixed,setFixed]=useState(true);return <ModalShell title={`Fill dates · ${staff.staff_name}`} subtitle="Manual bulk fill can replace only the selected person's chosen dates." onClose={onClose}><div className={styles.modalBody}><div className={styles.twoColumns}><div><label>From</label><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></div><div><label>To</label><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></div></div><label>Apply on</label><div className={styles.weekdayPicker}>{WEEKDAYS.map(x=><button key={x.value} className={weekdays.includes(x.value)?styles.selected:''} onClick={()=>setWeekdays(v=>v.includes(x.value)?v.filter(n=>n!==x.value):[...v,x.value])}>{x.label}</button>)}</div><label>Status</label><select value={status} onChange={e=>setStatus(e.target.value as EntryStatus)}>{STATUS_OPTIONS.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select>{status==='WORK'?<><label>Shift</label><select value={shiftId} onChange={e=>setShiftId(e.target.value)}>{active.map(x=><option key={x.id} value={x.id}>{x.shift_name} ({timeText(x.start_time)} – {timeText(x.end_time)})</option>)}</select></>:null}{staff.fixed_off_day?<label className={styles.fixedOffOption}><input type="checkbox" checked={fixed} onChange={e=>setFixed(e.target.checked)}/><span><strong>Keep fixed off day</strong><small>Every {WEEKDAYS.find(x=>x.value===staff.fixed_off_day)?.label} becomes Off.</small></span></label>:null}</div><footer className={styles.modalFooter}><span/><div><button className={styles.secondaryButton} onClick={onClose}>Cancel</button><button className={styles.primaryButton} disabled={busy||!weekdays.length||(status==='WORK'&&!shiftId)} onClick={()=>onSave({start,end,weekdays,status,shiftId,fixed})}>{busy?'Applying...':'Apply schedule'}</button></div></footer></ModalShell>;}
