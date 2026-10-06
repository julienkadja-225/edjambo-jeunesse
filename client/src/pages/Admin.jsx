import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { del, download, get, patch, post, put, upload } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../icons.jsx';
import {
  Async, Avatar, BarChart, Badge, SmsAnalysis, SmsBadge, Debounced, Empty, Field, Modal, PageHeader, Pager, ProofViewer, RichEditor, Stat,
  fmtDate, fmtDateTime, fmtMoney, fmtMonth, fullName, toLocalInput, useConfirm, useLoad, useQueryState, useToast,
} from '../ui.jsx';
import { ForumModeration } from './Forum.jsx';
import { Audit, Results } from './Elections.jsx';
import { AdminFinance, SmsGateway } from './AdminFinance.jsx';

/* ================= Vue d'ensemble ================= */
function Overview() {
  const state = useLoad(() => get('/admin/stats'), []);
  const { can } = useAuth();
  return (
    <div className="stack">
      <h1>Tableau de bord</h1>
      <Async state={state}>{(s) => (
        <>
          <div className="stats">
            <Stat icon="users" label="Membres inscrits" value={s.members_total.toLocaleString('fr-FR')} sub={`+${s.new_members_30d} sur 30 jours`} to={can('members') ? '/admin/membres' : undefined} />
            <Stat icon="check-circle" tone="green" label="Membres actifs" value={s.members_active.toLocaleString('fr-FR')} sub={`${s.members_suspended} suspendus`} to={can('members') ? '/admin/membres?status=active' : undefined} />
            <Stat icon="user" tone="orange" label="Inscriptions à valider" value={s.members_pending} to={can('members') ? '/admin/membres?status=pending' : undefined} />
            <Stat icon="file" tone="dark" label="Preuves à vérifier" value={s.payments_pending} to={can('payments') ? '/admin/paiements' : undefined} />
            <Stat icon="activity" tone="green" label="Taux de cotisation" value={`${s.contribution_rate} %`} sub="mois en cours" />
            <Stat icon="wallet" label="Collecté ce mois" value={fmtMoney(s.month_collected)} />
            <Stat icon="calendar" tone="orange" label="Événements à venir" value={s.upcoming_events} />
            <Stat icon="vote" tone="dark" label="Élections en cours" value={s.open_elections} to={can('elections') ? '/admin/elections' : undefined} />
          </div>
          {s.collection_history.length > 0 && (
            <div className="card"><h2>Cotisations collectées</h2><p className="muted small" style={{ marginTop: 0 }}>6 derniers mois, paiements validés</p>
              <BarChart data={s.collection_history.map((h) => ({ label: fmtMonth(h.month).split(' ')[0].slice(0, 4), value: h.total, sub: `${h.members} memb.` }))} format={(v) => (v >= 1000 ? `${Math.round(v / 1000)} k` : v)} /></div>
          )}
          <div className="cards">
            <div className="card"><h2>Membres actifs par quartier</h2><div className="bars">
              {s.by_neighborhood.map((n) => (
                <div className="row" key={n.neighborhood}><span className="lbl">{n.neighborhood}</span>
                  <div className="bar grow"><i style={{ width: `${(n.n / s.by_neighborhood[0].n) * 100}%` }} /></div><b>{n.n}</b></div>
              ))}</div></div>
            <div className="card"><h2>Prochains événements</h2>
              {s.upcoming.length ? s.upcoming.map((e) => <div key={e.id} style={{ padding: '.4rem 0' }}><b>{e.title}</b><div className="muted small"><Icon name="calendar" size={13} /> {fmtDateTime(e.event_date)} · <Icon name="map-pin" size={13} /> {e.location || '—'}</div></div>) : <Empty>Aucun événement planifié.</Empty>}
            </div>
          </div>
        </>
      )}</Async>
    </div>
  );
}

/* ================= Membres ================= */
function ReasonModal({ title, label, required, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}>
        <Field label={label}><textarea required={required} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn">Confirmer</button>
      </form>
    </Modal>
  );
}

function TempPasswordModal({ data, onClose }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(data.temporary_password); toast('Mot de passe copié'); } catch { /* */ } };
  return (
    <Modal title="Mot de passe temporaire" onClose={onClose}>
      <div className="stack">
        <div className="alert amber"><Icon name="alert" size={18} /> Ce mot de passe ne sera <b>plus affiché</b> après fermeture de cette fenêtre. Transmettez-le au membre de manière sûre.</div>
        <div className="small muted">Identifiant : <b>{data.identifier}</b> — {data.name}</div>
        <div className="temp-pw">{data.temporary_password}</div>
        <div className="row"><button className="btn" onClick={copy}><Icon name="copy" size={16} /> Copier</button><button className="btn ghost" onClick={onClose}>Terminé</button></div>
        <p className="muted small">Le membre devra choisir un nouveau mot de passe dès sa prochaine connexion. Ses sessions actuelles ont été fermées.</p>
      </div>
    </Modal>
  );
}

function Members() {
  const toast = useToast();
  const confirm = useConfirm();
  const [temp, setTemp] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [sp] = useSearchParams();
  const [q, set, setQ] = useQueryState({ q: '', status: sp.get('status') || '', payment: '', neighborhood: '', from: '', to: '', page: 1 });
  const hoods = useLoad(() => get('/members/neighborhoods'), []);
  const state = useLoad(() => get('/members', { ...q, limit: 20 }), [q]);
  const [ask, setAsk] = useState(null);
  const [detail, setDetail] = useState(null);

  const setStatus = async (m, status, reason) => {
    try { await patch(`/members/${m.id}/status`, { status, reason }); toast('Statut mis à jour'); setAsk(null); state.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const open = async (m) => setDetail(await get(`/members/${m.id}`));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkApprove = async () => {
    if (!(await confirm({ title: `Approuver ${sel.size} inscription(s) ?`, message: 'Les membres seront activés et notifiés.', confirmLabel: 'Approuver' }))) return;
    try { const r = await post('/members/bulk-approve', { ids: [...sel] }); toast(`${r.approved} inscription(s) approuvée(s)`); setSel(new Set()); state.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const exportCsv = async () => {
    setExporting(true);
    try { await download('/members/export.csv', { ...q, page: '', limit: '' }, 'membres.csv'); } catch (e) { toast(e.message, 'err'); } finally { setExporting(false); }
  };
  const resetPw = async (m) => {
    if (!(await confirm({ title: 'Réinitialiser le mot de passe ?', message: `Un mot de passe temporaire sera généré pour ${fullName(m)}. Ses sessions ouvertes seront fermées.`, confirmLabel: 'Réinitialiser' }))) return;
    try { const r = await post(`/members/${m.id}/reset-password`); setTemp({ ...r, name: fullName(m) }); state.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const unlock = async (m) => { try { await post(`/members/${m.id}/unlock`); toast('Compte déverrouillé'); state.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="stack">
      <PageHeader title="Membres" subtitle="Inscriptions, statuts et cotisations de la communauté.">
        <button className="btn ghost" onClick={exportCsv} disabled={exporting}><Icon name="file" size={16} /> {exporting ? 'Export…' : 'Exporter en CSV'}</button>
      </PageHeader>
      {sel.size > 0 && <div className="alert violet bulkbar"><span><b>{sel.size}</b> inscription(s) sélectionnée(s)</span><span className="row"><button className="btn green sm" onClick={bulkApprove}>Approuver la sélection</button><button className="btn ghost sm" onClick={() => setSel(new Set())}>Annuler</button></span></div>}
      <div className="filters">
        <div className="wide"><Debounced type="search" placeholder="Nom, email, téléphone…" value={q.q} onChange={(v) => set({ q: v })} /></div>
        <select aria-label="Filtrer par statut" value={q.status} onChange={(e) => set({ status: e.target.value })}><option value="">Tous statuts</option><option value="pending">En attente</option><option value="active">Actif</option><option value="suspended">Suspendu</option><option value="inactive">Inactif</option></select>
        <select aria-label="Filtrer par état de cotisation" value={q.payment} onChange={(e) => set({ payment: e.target.value })}><option value="">Cotisation (tous)</option><option value="paid">À jour</option><option value="unpaid">Non payée</option></select>
        <select aria-label="Filtrer par quartier" value={q.neighborhood} onChange={(e) => set({ neighborhood: e.target.value })}><option value="">Tous quartiers</option>{(hoods.data || []).map((h) => <option key={h}>{h}</option>)}</select>
        <label className="field"><span>Inscrit après</span><input type="date" value={q.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>Inscrit avant</span><input type="date" value={q.to} onChange={(e) => set({ to: e.target.value })} /></label>
      </div>
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Tout sélectionner (en attente)" checked={d.items.some((m) => m.status === 'pending') && d.items.filter((m) => m.status === 'pending').every((m) => sel.has(m.id))} onChange={(e) => setSel(e.target.checked ? new Set(d.items.filter((m) => m.status === 'pending').map((m) => m.id)) : new Set())} /></th><th>Membre</th><th className="hide-mobile">Contact</th><th>Quartier</th><th>Statut</th><th>Cotisation</th><th className="hide-mobile">Inscrit le</th><th>Actions</th></tr></thead>
            <tbody>{d.items.map((m) => (
              <tr key={m.id}>
                <td>{m.status === 'pending' ? <input type="checkbox" aria-label={`Sélectionner ${fullName(m)}`} checked={sel.has(m.id)} onChange={() => toggle(m.id)} /> : null}</td>
                <td><button className="link row" style={{ textDecoration: 'none', color: 'inherit', textAlign: 'left' }} onClick={() => open(m)}><Avatar u={m} size={32} /><b>{fullName(m)}</b></button></td>
                <td className="hide-mobile small">{m.email}<br />{m.phone}</td>
                <td>{m.neighborhood}</td>
                <td><Badge s={m.status} />{m.locked ? <> <Badge s="suspended">Verrouillé</Badge></> : null}{m.must_change_password ? <> <Badge s="pending">Mot de passe temporaire</Badge></> : null}</td>
                <td>{m.status === 'active' ? <Badge s={m.paid_current ? 'paid' : 'unpaid'} /> : '—'}</td>
                <td className="hide-mobile">{fmtDate(m.created_at)}</td>
                <td><div className="row" style={{ gap: '.3rem' }}>
                  {m.status === 'pending' && <><button className="btn green sm" onClick={() => setStatus(m, 'active')}>Approuver</button><button className="btn red sm" onClick={() => setAsk({ m, status: 'inactive', title: "Refuser l'inscription", required: true })}>Rejeter</button></>}
                  {m.status === 'active' && <button className="btn ghost sm" onClick={() => setAsk({ m, status: 'suspended', title: 'Suspendre le membre' })}>Suspendre</button>}
                  {['suspended', 'inactive'].includes(m.status) && <button className="btn ghost sm" onClick={() => setStatus(m, 'active')}>Réactiver</button>}
                  {m.status === 'active' && <button className="btn ghost sm" onClick={() => setAsk({ m, status: 'inactive', title: 'Passer en inactif' })}>Inactif</button>}
                  {m.locked && <button className="btn ghost sm" onClick={() => unlock(m)}><Icon name="unlock" size={15} /> Déverrouiller</button>}
                  {m.status !== 'pending' && <button className="btn ghost sm" title="Réinitialiser le mot de passe" onClick={() => resetPw(m)}><Icon name="key" size={15} /> Mot de passe</button>}
                </div></td>
              </tr>
            ))}</tbody></table></div>
          <Pager data={d} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}</Async>
      {temp && <TempPasswordModal data={temp} onClose={() => setTemp(null)} />}
      {ask && <ReasonModal title={ask.title} label="Motif" required={ask.required} onClose={() => setAsk(null)} onSubmit={(r) => setStatus(ask.m, ask.status, r)} />}
      {detail && (
        <Modal title={fullName(detail)} onClose={() => setDetail(null)}>
          <div className="stack">
            <div className="row"><Avatar u={detail} size={60} /><div><Badge s={detail.status} /><div className="muted small">{detail.age} ans · {detail.neighborhood}</div></div></div>
            <div className="small">{detail.email || '—'} · {detail.phone || '—'}<br />Inscrit le {fmtDate(detail.created_at)} · dernière connexion {fmtDateTime(detail.last_login)}</div>
            {detail.status_reason && <div className="alert amber">Motif : {detail.status_reason}</div>}
            <h3>Cotisations</h3>
            {detail.contributions?.length ? <div className="table-wrap"><table><tbody>{detail.contributions.map((c) => <tr key={c.id}><td>{fmtMonth(c.month)}</td><td>{fmtMoney(c.amount)}</td><td>{c.method_label}</td><td><Badge s={c.status} /></td></tr>)}</tbody></table></div> : <p className="muted">Aucune.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= Cotisations ================= */
function Payments() {
  const toast = useToast();
  const stats = useLoad(() => get('/contributions/stats'), []);
  const [tab, setTab] = useState('pending');
  const [q, set, setQ] = useQueryState({ q: '', month: '', level: '', page: 1 });
  const confirm = useConfirm();
  const list = useLoad(() => (tab === 'defaulters' ? get('/contributions/defaulters', { page: q.page, limit: 20 }) : get('/contributions', { status: tab === 'history' ? '' : 'pending', ...q, limit: 15 })), [tab, q]);
  const [review, setReview] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const refresh = () => { list.reload(); stats.reload(); };

  const approve = async (c) => { try { await post(`/contributions/${c.id}/approve`); toast('Cotisation validée '); setReview(null); refresh(); } catch (e) { toast(e.message, 'err'); } };
  const reject = async (c, reason) => { try { await post(`/contributions/${c.id}/reject`, { reason }); toast('Cotisation rejetée'); setRejecting(false); setReview(null); refresh(); } catch (e) { toast(e.message, 'err'); } };
  const exportPayments = async () => { try { await download('/contributions/export.csv', { status: tab === 'history' ? '' : tab === 'pending' ? 'pending' : '', month: q.month, q: q.q }, 'cotisations.csv'); } catch (e) { toast(e.message, 'err'); } };
  const bulkApprove = async () => {
    const r = await get('/contributions', { status: 'pending', level: 'consistent', limit: 100 });
    if (!r.items.length) return toast('Aucun paiement cohérent en attente');
    if (!(await confirm({ title: `Valider ${r.items.length} paiement(s) cohérent(s) ?`, message: 'Le SMS de chaque paiement correspond au compte, au montant attendu et à une référence unique. Les membres seront notifiés.', confirmLabel: 'Valider' }))) return;
    try { const x = await post('/contributions/bulk-approve', { ids: r.items.map((c) => c.id) }); toast(`${x.approved} paiement(s) validé(s)`); refresh(); } catch (e) { toast(e.message, 'err'); }
  };
  const remind = async () => { const r = await post('/contributions/reminders'); toast(`${r.sent} rappel(s) envoyé(s) `); };

  return (
    <div className="stack">
      <PageHeader title="Cotisations" subtitle="Vérification des preuves de paiement et suivi des retardataires.">
        <button className="btn ghost" onClick={exportPayments}><Icon name="file" size={16} /> Exporter en CSV</button>
        <button className="btn orange" onClick={remind}><Icon name="bell" size={16} /> Envoyer les rappels</button>
      </PageHeader>
      <Async state={stats}>{(s) => (
        <div className="stats">
          <Stat label="Total collecté" value={fmtMoney(s.total_collected)} />
          <Stat tone="green" label={`Collecté — ${fmtMonth(s.month)}`} value={fmtMoney(s.month_collected)} sub={`${s.paid_members} / ${s.active_members} membres (${s.rate} %)`} />
          <Stat tone="orange" label="Preuves en attente" value={s.pending} sub={`dont ${s.pending_consistent} SMS cohérent(s)`} />
          <Stat tone="red" label="Retardataires" value={s.defaulters} />
        </div>
      )}</Async>
      <div className="chips">
        {[['pending', 'À vérifier'], ['history', 'Historique'], ['defaulters', 'Retardataires']].map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => { setTab(k); setQ({ q: '', month: '', page: 1 }); }}>{l}</button>)}
      </div>
      {tab === 'pending' && (
        <div className="row between">
          <div className="chips" style={{ margin: 0 }}>{[['', 'Tous'], ['consistent', 'SMS cohérents'], ['review', 'SMS à vérifier'], ['none', 'Sans SMS']].map(([k, l]) => <button key={k} className={`chip ${q.level === k ? 'on' : ''}`} onClick={() => set({ level: k })}>{l}</button>)}</div>
          <button className="btn green sm" onClick={bulkApprove}><Icon name="check" size={15} /> Valider les paiements cohérents</button>
        </div>
      )}
      {tab !== 'defaulters' && <div className="filters"><div className="wide"><Debounced type="search" placeholder="Nom ou référence…" value={q.q} onChange={(v) => set({ q: v })} /></div>
        {tab === 'history' && <input type="month" value={q.month} onChange={(e) => set({ month: e.target.value })} />}</div>}
      <Async state={list} empty={(d) => !d.items.length}>{(d) => (
        <>
          <div className="table-wrap">{tab === 'defaulters' ? (
            <table><thead><tr><th>Membre</th><th>Contact</th><th>Quartier</th><th>État</th></tr></thead>
              <tbody>{d.items.map((m) => <tr key={m.id}><td><b>{fullName(m)}</b></td><td className="small">{m.phone}<br />{m.email}</td><td>{m.neighborhood}</td><td>{m.has_pending ? <Badge s="pending">Preuve en attente</Badge> : <Badge s="unpaid" />}</td></tr>)}</tbody></table>
          ) : (
            <table><thead><tr><th>Membre</th><th>Mois</th><th>Montant</th><th className="hide-mobile">Moyen</th><th className="hide-mobile">Référence</th><th>SMS</th><th>Statut</th><th /></tr></thead>
              <tbody>{d.items.map((c) => (
                <tr key={c.id}>
                  <td><b>{fullName(c)}</b><div className="muted small">{fmtDate(c.created_at)}</div></td>
                  <td>{fmtMonth(c.month)}</td><td className="nowrap">{fmtMoney(c.amount)}</td>
                  <td className="hide-mobile">{c.method_label}</td><td className="hide-mobile">{c.reference || '—'}</td>
                  <td><SmsBadge level={c.sms_level} /></td>
                  <td><Badge s={c.status} />{c.reject_reason && <div className="muted small">{c.reject_reason}</div>}</td>
                  <td><button className="btn sm" onClick={() => setReview(c)}>{c.status === 'pending' ? 'Examiner' : 'Voir'}</button></td>
                </tr>
              ))}</tbody></table>
          )}</div>
          <Pager data={d} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}</Async>
      {review && (
        <Modal title={`Preuve — ${fullName(review)}`} onClose={() => setReview(null)} wide>
          <div className="stack">
            <div className="grid2">
              <div><div className="muted small">Mois</div><b>{fmtMonth(review.month)}</b></div>
              <div><div className="muted small">Montant</div><b>{fmtMoney(review.amount)}</b></div>
              <div><div className="muted small">Moyen</div><b>{review.method_label}</b></div>
              <div><div className="muted small">Référence saisie</div><b>{review.reference || '—'}</b></div>
            </div>
            {review.sms_text && (
              <div className="stack">
                <SmsAnalysis a={{ level: review.sms_level, sms_flags: review.sms_flags, parsed: null }} />
                <div><div className="muted small">SMS collé par le membre</div><div className="invite-preview pre">{review.sms_text}</div></div>
              </div>
            )}
            {review.has_proof ? <ProofViewer id={review.id} /> : <div className="alert amber">{review.sms_text ? 'Aucune capture jointe : comparez le SMS au relevé du compte de réception.' : 'Aucune capture jointe : vérifiez la référence auprès du compte de réception.'}</div>}
            {review.status === 'pending'
              ? <div className="row"><button className="btn green" onClick={() => approve(review)}>Approuver</button><button className="btn red" onClick={() => setRejecting(true)}>Rejeter</button></div>
              : <Badge s={review.status} />}
          </div>
        </Modal>
      )}
      {rejecting && review && <ReasonModal title="Motif du rejet" label="Expliquez au membre pourquoi" required onClose={() => setRejecting(false)} onSubmit={(r) => reject(review, r)} />}
    </div>
  );
}

/* ================= Infos de paiement ================= */
function PaymentInfo() {
  const toast = useToast();
  const methods = useLoad(() => get('/payment-methods'), []);
  const settings = useLoad(() => get('/contribution-settings'), []);
  const [edit, setEdit] = useState(null);
  const blank = { type: 'mobile_money', label: '', account_number: '', account_name: 'Jeunesse EDJAMBO', details: '', active: true };

  const save = async (e) => {
    e.preventDefault();
    try { edit.id ? await put(`/payment-methods/${edit.id}`, edit) : await post('/payment-methods', edit); toast('Enregistré '); setEdit(null); methods.reload(); } catch (er) { toast(er.message, 'err'); }
  };
  const confirm = useConfirm();
  const remove = async (m) => { if (await confirm({ title: 'Supprimer ce compte de paiement ?', message: m.label, danger: true, confirmLabel: 'Supprimer' })) { await del(`/payment-methods/${m.id}`); methods.reload(); } };
  const saveSettings = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await put('/contribution-settings', Object.fromEntries(f)); toast('Paramètres enregistrés '); settings.reload(); } catch (er) { toast(er.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="row between"><h1>Infos de paiement</h1><button className="btn" onClick={() => setEdit(blank)}>+ Ajouter</button></div>
      <p className="muted">Ces comptes sont affichés aux membres pour payer leur cotisation.</p>
      <Async state={methods} empty={(d) => !d.length}>{(d) => (
        <div className="cards three">{d.map((m) => (
          <div key={m.id} className="pay-card" style={m.active ? undefined : { opacity: .55 }}>
            <div className="row between"><Badge s={m.type === 'bank' ? 'draft' : 'event'}>{m.type === 'bank' ? 'Banque' : 'Mobile Money'}</Badge>{!m.active && <Badge s="inactive" />}</div>
            <h3 style={{ marginTop: '.4rem' }}>{m.label}</h3><div className="num">{m.account_number}</div>
            <div className="muted small">{m.account_name}</div>{m.details && <div className="small">{m.details}</div>}
            <div className="row" style={{ marginTop: '.5rem' }}><button className="btn ghost sm" onClick={() => setEdit(m)}>Modifier</button><button className="btn red sm" onClick={() => remove(m)}>Supprimer</button></div>
          </div>
        ))}</div>
      )}</Async>
      <Async state={settings}>{(s) => (
        <form className="card stack" onSubmit={saveSettings} key={s.monthly_amount}>
          <h2>Paramètres de cotisation</h2>
          <div className="grid2">
            <Field label="Montant mensuel (FCFA)"><input type="number" name="monthly_amount" min="1" defaultValue={s.monthly_amount} /></Field>
            <Field label="Délai de grâce (jours)" hint="Le mois précédent reste valable pour voter pendant ce délai."><input type="number" name="grace_days" min="0" max="28" defaultValue={s.grace_days} /></Field>
            <Field label="Jour d'envoi des rappels" hint="Rappel automatique aux membres n'ayant pas payé."><input type="number" name="reminder_day" min="1" max="28" defaultValue={s.reminder_day} /></Field>
          </div>
          <button className="btn">Enregistrer</button>
        </form>
      )}</Async>
      {edit && (
        <Modal title={edit.id ? 'Modifier le compte' : 'Nouveau compte de paiement'} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={save}>
            <Field label="Type"><select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}><option value="mobile_money">Mobile Money</option><option value="bank">Virement bancaire</option></select></Field>
            <Field label="Libellé (ex. Orange Money)"><input type="text" required value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></Field>
            <Field label="Numéro / IBAN"><input type="text" required value={edit.account_number} onChange={(e) => setEdit({ ...edit, account_number: e.target.value })} /></Field>
            <Field label="Nom du titulaire"><input type="text" value={edit.account_name || ''} onChange={(e) => setEdit({ ...edit, account_name: e.target.value })} /></Field>
            <Field label="Détails / consignes"><input type="text" value={edit.details || ''} onChange={(e) => setEdit({ ...edit, details: e.target.value })} /></Field>
            <label className="checkbox"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Afficher aux membres</label>
            <button className="btn">Enregistrer</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ================= Élections ================= */
function ElectionForm({ onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', start_at: '', end_at: '', require_contribution: true });
  const [cands, setCands] = useState([{ name: '', program: '' }, { name: '', program: '' }]);
  const setC = (i, k, v) => setCands(cands.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const submit = async (e) => {
    e.preventDefault();
    try {
      await post('/elections', { ...f, start_at: new Date(f.start_at).toISOString(), end_at: new Date(f.end_at).toISOString(), candidates: cands.filter((c) => c.name.trim()) });
      toast('Élection créée (brouillon)'); onDone();
    } catch (er) { toast(er.message, 'err'); }
  };
  return (
    <Modal title="Nouvelle élection" onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <Field label="Poste à pourvoir"><input type="text" required placeholder="Président de la Jeunesse" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Description"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Début du vote"><input type="datetime-local" required value={f.start_at} onChange={(e) => setF({ ...f, start_at: e.target.value })} /></Field>
          <Field label="Fin du vote"><input type="datetime-local" required value={f.end_at} onChange={(e) => setF({ ...f, end_at: e.target.value })} /></Field>
        </div>
        <label className="checkbox"><input type="checkbox" checked={f.require_contribution} onChange={(e) => setF({ ...f, require_contribution: e.target.checked })} /> Réservé aux membres actifs à jour de cotisation</label>
        <h3>Candidats (2 minimum pour ouvrir)</h3>
        {cands.map((c, i) => (
          <div key={i} className="grid2">
            <input type="text" placeholder={`Candidat ${i + 1}`} value={c.name} onChange={(e) => setC(i, 'name', e.target.value)} />
            <input type="text" placeholder="Programme (optionnel)" value={c.program} onChange={(e) => setC(i, 'program', e.target.value)} />
          </div>
        ))}
        <button type="button" className="btn ghost sm" onClick={() => setCands([...cands, { name: '', program: '' }])}>+ Ajouter un candidat</button>
        <button className="btn">Créer le brouillon</button>
      </form>
    </Modal>
  );
}

function ElectionManage({ id, onClose, onChange }) {
  const toast = useToast();
  const e = useLoad(() => get(`/elections/${id}`), [id]);
  const live = useLoad(() => get(`/elections/${id}/live`), [id]);
  const [cand, setCand] = useState({ name: '', program: '' });
  const [audit, setAudit] = useState(false);
  const confirm = useConfirm();
  const act = async (path, msg, confirmMsg) => {
    if (confirmMsg && !(await confirm({ title: 'Confirmation', message: confirmMsg }))) return;
    try { await post(`/elections/${id}/${path}`); toast(msg); e.reload(); live.reload(); onChange(); } catch (er) { toast(er.message, 'err'); }
  };
  const addCand = async (ev) => {
    ev.preventDefault();
    try { await post(`/elections/${id}/candidates`, cand); setCand({ name: '', program: '' }); e.reload(); } catch (er) { toast(er.message, 'err'); }
  };
  const rmCand = async (cid) => { await del(`/elections/${id}/candidates/${cid}`); e.reload(); };
  return (
    <Modal title="Gérer l'élection" onClose={onClose} wide>
      <Async state={e}>{(el) => (
        <div className="stack">
          <div className="row"><Badge s={el.status} /><b>{el.title}</b></div>
          <div className="muted small">Du {fmtDateTime(el.start_at)} au {fmtDateTime(el.end_at)}</div>
          {live.data && (
            <div className="alert violet">Participation en direct : <b>{live.data.turnout}</b> votant(s) sur {live.data.eligible_members} membres actifs ({Math.round((live.data.turnout / Math.max(1, live.data.eligible_members)) * 100)} %).
              <button className="link" style={{ marginLeft: '.5rem' }} onClick={live.reload}>Actualiser</button></div>
          )}
          {el.status !== 'draft' && live.data && <Results e={{ ...el, candidates: live.data.results.map((r) => ({ ...r })) }} />}
          {el.status === 'draft' && (
            <>
              <h3>Candidats</h3>
              {el.candidates.map((c) => <div key={c.id} className="row between card flat"><span><b>{c.name}</b><div className="muted small">{c.program}</div></span><button className="btn red sm" onClick={() => rmCand(c.id)}>Retirer</button></div>)}
              <form className="grid2" onSubmit={addCand}>
                <input type="text" required placeholder="Nom du candidat" value={cand.name} onChange={(ev) => setCand({ ...cand, name: ev.target.value })} />
                <input type="text" placeholder="Programme" value={cand.program} onChange={(ev) => setCand({ ...cand, program: ev.target.value })} />
                <button className="btn ghost sm">+ Ajouter</button>
              </form>
            </>
          )}
          <div className="row">
            {el.stored_status === 'draft' && <><button className="btn green" onClick={() => act('open', 'Élection ouverte ', 'Ouvrir le vote ? Tous les membres seront notifiés et la configuration sera verrouillée.')}>Ouvrir le vote</button>
              <button className="btn red" onClick={async () => { if (await confirm({ title: 'Supprimer ce brouillon ?', danger: true, confirmLabel: 'Supprimer' })) { await del(`/elections/${id}`); onChange(); onClose(); } }}>Supprimer</button></>}
            {el.stored_status === 'open' && <button className="btn orange" onClick={() => act('close', 'Élection clôturée', 'Clôturer maintenant ? Plus aucun vote ne sera accepté.')}>Clôturer</button>}
            {el.status === 'closed' && <button className="btn" onClick={() => act('publish', 'Résultats publiés ', 'Publier les résultats à tous les membres ?')}>Publier les résultats</button>}
            {el.status !== 'draft' && <button className="btn ghost" onClick={() => setAudit(true)}>Audit</button>}
          </div>
          {audit && <Audit id={id} onClose={() => setAudit(false)} />}
        </div>
      )}</Async>
    </Modal>
  );
}

function Elections() {
  const state = useLoad(() => get('/elections'), []);
  const [creating, setCreating] = useState(false);
  const [manage, setManage] = useState(null);
  return (
    <div className="stack">
      <div className="row between"><h1>Élections</h1><button className="btn" onClick={() => setCreating(true)}>+ Nouvelle élection</button></div>
      <Async state={state} empty={(d) => !d.length}>{(d) => (
        <div className="table-wrap"><table>
          <thead><tr><th>Poste</th><th>Statut</th><th className="hide-mobile">Période</th><th>Votants</th><th /></tr></thead>
          <tbody>{d.map((e) => (
            <tr key={e.id}><td><b>{e.title}</b></td><td><Badge s={e.status} /></td><td className="hide-mobile small">{fmtDateTime(e.start_at)}<br />→ {fmtDateTime(e.end_at)}</td><td>{e.turnout ?? '—'}</td>
              <td><button className="btn sm" onClick={() => setManage(e.id)}>Gérer</button></td></tr>
          ))}</tbody></table></div>
      )}</Async>
      {creating && <ElectionForm onClose={() => setCreating(false)} onDone={() => { setCreating(false); state.reload(); }} />}
      {manage && <ElectionManage id={manage} onClose={() => setManage(null)} onChange={state.reload} />}
    </div>
  );
}

/* ================= Annonces ================= */
function AnnouncementForm({ item, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ type: item?.type || 'announcement', title: item?.title || '', body: item?.body || '', event_date: toLocalInput(item?.event_date), location: item?.location || '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (file && file.size > 5 * 1024 * 1024) return toast('Fichier trop volumineux (5 Mo max)', 'err');
    const form = new FormData();
    form.append('type', f.type); form.append('title', f.title); form.append('body', f.body); form.append('location', f.location);
    if (f.type === 'event') form.append('event_date', new Date(f.event_date).toISOString());
    if (file) form.append('media', file);
    setBusy(true);
    try { await upload(item ? `/announcements/${item.id}` : '/announcements', form, item ? 'PUT' : 'POST'); toast(item ? 'Modifié ' : 'Publié, membres notifiés '); onDone(); }
    catch (er) { toast(er.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? "Modifier l'annonce" : 'Publier'} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="grid2">
          <Field label="Type"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="announcement">Annonce</option><option value="event">Événement</option></select></Field>
          <Field label="Titre"><input type="text" required maxLength={150} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          {f.type === 'event' && <Field label="Date & heure"><input type="datetime-local" required value={f.event_date} onChange={(e) => setF({ ...f, event_date: e.target.value })} /></Field>}
          <Field label="Lieu"><input type="text" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        </div>
        <Field label="Contenu"><RichEditor value={f.body} onChange={(body) => setF((s) => ({ ...s, body }))} /></Field>
        <Field label="Média (image ou PDF)" hint="JPG, PNG ou PDF — 5 Mo max"><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <button className="btn" disabled={busy}>{busy ? 'Envoi…' : item ? 'Enregistrer' : 'Publier'}</button>
      </form>
    </Modal>
  );
}

function Announcements() {
  const toast = useToast();
  const [q, set, setQ] = useQueryState({ q: '', page: 1 });
  const state = useLoad(() => get('/announcements', { ...q, limit: 12 }), [q]);
  const [form, setForm] = useState(null);
  const confirm = useConfirm();
  const remove = async (a) => { if (await confirm({ title: 'Supprimer cette publication ?', message: a.title, danger: true, confirmLabel: 'Supprimer' })) { await del(`/announcements/${a.id}`); toast('Supprimé'); state.reload(); } };
  return (
    <div className="stack">
      <div className="row between"><h1>Annonces & événements</h1><button className="btn" onClick={() => setForm({})}>+ Publier</button></div>
      <Debounced type="search" placeholder="Rechercher…" value={q.q} onChange={(v) => set({ q: v })} />
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Titre</th><th>Type</th><th className="hide-mobile">Publié</th><th>Engagement</th><th /></tr></thead>
            <tbody>{d.items.map((a) => (
              <tr key={a.id}><td><Link to={`/annonces/${a.id}`}><b>{a.title}</b></Link>{a.event_date && <div className="muted small">{fmtDateTime(a.event_date)}</div>}</td>
                <td><Badge s={a.type} /></td><td className="hide-mobile">{fmtDate(a.created_at)}</td><td className="small">{a.rsvp_count} · {a.share_count}</td>
                <td><div className="row" style={{ gap: '.3rem' }}><button className="btn ghost sm" onClick={() => setForm(a)}>Modifier</button><button className="btn red sm" onClick={() => remove(a)}>Supprimer</button></div></td></tr>
            ))}</tbody></table></div>
          <Pager data={d} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}</Async>
      {form && <AnnouncementForm item={form.id ? form : null} onClose={() => setForm(null)} onDone={() => { setForm(null); state.reload(); }} />}
    </div>
  );
}

/* ================= Forum ================= */
function Forum() {
  const toast = useToast();
  const cats = useLoad(() => get('/forum/categories'), []);
  const [name, setName] = useState('');
  const add = async (e) => { e.preventDefault(); try { await post('/forum/categories', { name }); setName(''); cats.reload(); toast('Catégorie ajoutée'); } catch (er) { toast(er.message, 'err'); } };
  const confirm = useConfirm();
  const rm = async (c) => { if (await confirm({ title: `Supprimer « ${c.name} » ?`, message: 'Ses discussions seront conservées sans catégorie.', danger: true, confirmLabel: 'Supprimer' })) { await del(`/forum/categories/${c.id}`); cats.reload(); } };
  return (
    <div className="stack">
      <div className="card stack">
        <h2>Catégories du forum</h2>
        <div className="row">{(cats.data || []).map((c) => <span key={c.id} className="chip">{c.name} <button className="link" onClick={() => rm(c)} aria-label={`Supprimer ${c.name}`}><Icon name="x" size={13} /></button></span>)}</div>
        <form className="row" onSubmit={add}><input type="text" style={{ maxWidth: 260 }} required placeholder="Nouvelle catégorie" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn sm">Ajouter</button></form>
      </div>
      <ForumModeration />
    </div>
  );
}

/* ================= Équipe (Super Admin) ================= */
const PERMS = { members: 'Membres', payments: 'Cotisations', forum: 'Forum', announcements: 'Annonces', elections: 'Élections', finance: 'Finances' };

function Team() {
  const toast = useToast();
  const state = useLoad(() => get('/admin/admins'), []);
  const [edit, setEdit] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try { edit.id ? await put(`/admin/admins/${edit.id}`, edit) : await post('/admin/admins', edit); toast('Enregistré '); setEdit(null); state.reload(); } catch (er) { toast(er.message, 'err'); }
  };
  const confirm = useConfirm();
  const remove = async (a) => { if (await confirm({ title: `Supprimer le compte de ${fullName(a)} ?`, danger: true, confirmLabel: 'Supprimer' })) { await del(`/admin/admins/${a.id}`); state.reload(); } };
  const backup = async () => { const r = await post('/admin/backup'); toast(`Sauvegarde créée : ${r.file}`); };
  const toggle = (p) => setEdit({ ...edit, permissions: edit.permissions.includes(p) ? edit.permissions.filter((x) => x !== p) : [...edit.permissions, p] });
  return (
    <div className="stack">
      <div className="row between"><h1>Équipe d'administration</h1><div className="row"><button className="btn ghost" onClick={backup}>Sauvegarder la base</button><button className="btn" onClick={() => setEdit({ first_name: '', last_name: '', email: '', phone: '', password: '', permissions: [] })}>+ Nouvel admin</button></div></div>
      <Async state={state}>{(d) => (
        <div className="table-wrap"><table>
          <thead><tr><th>Nom</th><th>Rôle</th><th>Permissions</th><th>Statut</th><th /></tr></thead>
          <tbody>{d.map((a) => (
            <tr key={a.id}><td><b>{fullName(a)}</b><div className="muted small">{a.email || a.phone}</div></td><td><Badge s={a.role} /></td>
              <td className="small">{a.role === 'super_admin' ? 'Toutes' : a.permissions.map((p) => PERMS[p]).join(', ') || '—'}</td><td><Badge s={a.status} /></td>
              <td>{a.role === 'admin' && <div className="row" style={{ gap: '.3rem' }}><button className="btn ghost sm" onClick={() => setEdit({ ...a, password: '' })}>Modifier</button><button className="btn red sm" onClick={() => remove(a)}>Supprimer</button></div>}</td></tr>
          ))}</tbody></table></div>
      )}</Async>
      {edit && (
        <Modal title={edit.id ? 'Modifier un administrateur' : 'Nouvel administrateur'} onClose={() => setEdit(null)}>
          <form className="stack" onSubmit={save}>
            {!edit.id && <div className="grid2">
              <Field label="Prénom"><input type="text" required value={edit.first_name} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} /></Field>
              <Field label="Nom"><input type="text" required value={edit.last_name} onChange={(e) => setEdit({ ...edit, last_name: e.target.value })} /></Field>
              <Field label="Email"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="Téléphone"><input type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            </div>}
            <Field label={edit.id ? 'Nouveau mot de passe (laisser vide pour conserver)' : 'Mot de passe'}><input type="password" minLength={8} required={!edit.id} value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
            <div><b>Permissions</b><div className="perm-list" style={{ marginTop: '.4rem' }}>{Object.entries(PERMS).map(([k, l]) => <label key={k} className="checkbox"><input type="checkbox" checked={edit.permissions.includes(k)} onChange={() => toggle(k)} />{l}</label>)}</div></div>
            {edit.id && <Field label="Statut"><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">Actif</option><option value="suspended">Suspendu</option></select></Field>}
            <button className="btn">Enregistrer</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ================= Journal d'activité (Super Admin) ================= */
const ACTIONS = {
  'member.active': ['Membre activé', 'green'], 'member.inactive': ['Membre inactif / rejeté', 'gray'], 'member.suspended': ['Membre suspendu', 'red'],
  'member.pending': ['Membre remis en attente', 'amber'], 'member.reset_password': ['Mot de passe réinitialisé', 'orange'], 'member.unlock': ['Compte déverrouillé', 'violet'],
  'payment.approved': ['Cotisation validée', 'green'], 'payment.rejected': ['Cotisation rejetée', 'red'],
  'election.open': ['Élection ouverte', 'green'], 'election.close': ['Élection clôturée', 'amber'], 'election.publish': ['Résultats publiés', 'violet'],
  'announcement.create': ['Publication créée', 'violet'], 'announcement.delete': ['Publication supprimée', 'red'],
  'admin.create': ['Admin créé', 'violet'], 'admin.update': ['Admin modifié', 'amber'], 'admin.delete': ['Admin supprimé', 'red'], 'system.backup': ['Sauvegarde', 'gray'],
};
function AuditLog() {
  const [q, set, setQ] = useQueryState({ q: '', action: '', page: 1 });
  const state = useLoad(() => get('/admin/audit', { ...q, limit: 25 }), [q]);
  return (
    <div className="stack">
      <PageHeader title="Journal d'activité" subtitle="Traçabilité des actions sensibles réalisées par l'équipe d'administration." />
      <div className="filters">
        <div className="wide"><Debounced type="search" placeholder="Rechercher (nom, détail)…" value={q.q} onChange={(v) => set({ q: v })} /></div>
        <select aria-label="Filtrer par type d'action" value={q.action} onChange={(e) => set({ action: e.target.value })}>
          <option value="">Toutes les actions</option><option value="member">Membres</option><option value="payment">Cotisations</option>
          <option value="election">Élections</option><option value="announcement">Annonces</option><option value="admin">Équipe</option><option value="system">Système</option>
        </select>
      </div>
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Détail</th></tr></thead>
            <tbody>{d.items.map((l) => (
              <tr key={l.id}><td className="nowrap small">{fmtDateTime(l.created_at)}</td><td>{l.first_name ? fullName(l) : <span className="muted">Système</span>}</td>
                <td><span className={`badge ${ACTIONS[l.action]?.[1] || 'gray'}`}>{ACTIONS[l.action]?.[0] || l.action}</span></td><td className="small">{l.detail || '—'}</td></tr>
            ))}</tbody></table></div>
          <Pager data={d} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}</Async>
    </div>
  );
}

/* ================= Messages signalés ================= */
function Reports() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const state = useLoad(() => get('/messages/reports', { status, page, limit: 15 }), [status, page]);
  const act = async (r, action) => {
    const labels = { dismiss: 'Classer sans suite ?', delete_message: 'Supprimer ce message ?', suspend_sender: `Suspendre ${r.sender_first} ${r.sender_last} et supprimer le message ?` };
    if (!(await confirm({ title: labels[action], danger: action !== 'dismiss', confirmLabel: 'Confirmer' }))) return;
    try { await patch(`/messages/reports/${r.id}`, { action }); toast('Signalement traité'); state.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <PageHeader title="Messages signalés" subtitle="Seuls le message signalé et son contexte immédiat sont visibles ; les conversations restent privées." />
      <div className="chips">
        {[['open', 'À traiter'], ['actioned', 'Traités'], ['dismissed', 'Sans suite']].map(([k, l]) => <button key={k} className={`chip ${status === k ? 'on' : ''}`} onClick={() => { setStatus(k); setPage(1); }}>{l}</button>)}
      </div>
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <>
          {d.items.map((r) => (
            <div key={r.id} className="card stack">
              <div className="row between">
                <span className="small muted">Signalé par <b>{r.reporter_first} {r.reporter_last}</b> · {fmtDateTime(r.created_at)} · {r.conv_type === 'group' ? `groupe « ${r.conv_title} »` : 'discussion privée'}{r.report_count > 1 ? ` · ${r.report_count} signalements` : ''}</span>
                <Badge s={r.status === 'open' ? 'pending' : r.status === 'actioned' ? 'approved' : 'inactive'}>{r.status === 'open' ? 'À traiter' : r.status === 'actioned' ? 'Traité' : 'Sans suite'}</Badge>
              </div>
              {r.context.map((c, i) => c.body && <div key={i} className="small muted">{c.first_name} : {c.body}</div>)}
              <div className="invite-preview"><b>{r.sender_first} {r.sender_last}</b> : {r.deleted_at ? <i>(message supprimé)</i> : r.body}</div>
              {r.reason && <div className="small">Motif : {r.reason}</div>}
              {r.status === 'open' && (
                <div className="row">
                  <button className="btn ghost sm" onClick={() => act(r, 'dismiss')}>Sans suite</button>
                  <button className="btn red sm" onClick={() => act(r, 'delete_message')}>Supprimer le message</button>
                  {r.sender_status === 'active' && <button className="btn red sm" onClick={() => act(r, 'suspend_sender')}>Supprimer + suspendre l'auteur</button>}
                </div>
              )}
            </div>
          ))}
          <Pager data={d} onPage={setPage} />
        </>
      )}</Async>
    </div>
  );
}

const NEEDS = { members: 'members', payments: 'payments', paymentInfo: 'payments', elections: 'elections', announcements: 'announcements', forum: 'forum', reports: 'forum', finance: 'finance' };
const SUPER_ONLY = new Set(['team', 'audit', 'sms']);

export default function Admin({ page }) {
  const { can, isSuper } = useAuth();
  if ((NEEDS[page] && !can(NEEDS[page])) || (SUPER_ONLY.has(page) && !isSuper)) {
    return (
      <div className="card stack" role="alert">
        <h1>Accès refusé</h1>
        <p className="muted">Votre rôle ne comprend pas cette rubrique. Demandez la permission au Super Admin si elle vous est nécessaire.</p>
        <div><Link className="btn" to="/admin">Retour au tableau de bord</Link></div>
      </div>
    );
  }
  return { overview: <Overview />, members: <Members />, payments: <Payments />, paymentInfo: <PaymentInfo />, elections: <Elections />, announcements: <Announcements />, forum: <Forum />, team: <Team />, audit: <AuditLog />, reports: <Reports />, finance: <AdminFinance />, sms: <SmsGateway /> }[page];
}
