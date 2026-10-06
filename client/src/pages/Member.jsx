import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, download, get, post, put, qs, upload } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../icons.jsx';
import {
  Async, Avatar, Badge, Debounced, Empty, Field, Html, Modal, PageHeader, PasswordInput, Pager, SmsAnalysis, Spinner, Stat, fmtDate, fmtDateTime,
  fmtMoney, fmtMonth, fullName, useLoad, useQueryState, useToast, ProofViewer,
} from '../ui.jsx';

/* ================= Annonces ================= */
export function AnnouncementCard({ a, onChange, full }) {
  const toast = useToast();
  const link = `${location.origin}/a/${a.id}`;
  const rsvp = async () => { const r = await post(`/announcements/${a.id}/rsvp`); toast(r.active ? 'Présence confirmée ' : 'Présence annulée'); onChange?.(); };
  const reshare = async () => { const r = await post(`/announcements/${a.id}/reshare`); toast(r.active ? 'Republié sur votre profil ' : 'Retiré de votre profil'); onChange?.(); };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: a.title, url: link });
      else { await navigator.clipboard.writeText(link); toast('Lien copié '); }
    } catch { /* annulé */ }
  };
  return (
    <article className="card">
      {a.media && /\.(jpe?g|png)$/i.test(a.media) && <img className="ann-media" src={`/uploads/${a.media}`} alt="" loading="lazy" />}
      <div className="row"><Badge s={a.type} />{a.event_date && <span className="event-date"><Icon name="calendar" size={15} /> {fmtDateTime(a.event_date)}</span>}<span className="muted small">{fmtDate(a.created_at)}</span></div>
      <h2 style={{ marginTop: '.5rem' }}>{full ? a.title : <Link to={`/annonces/${a.id}`} style={{ color: 'inherit' }}>{a.title}</Link>}</h2>
      {a.location && <p className="muted row" style={{ margin: '0 0 .4rem', gap: '.3rem' }}><Icon name="map-pin" size={16} /> {a.location}</p>}
      {full ? <Html html={a.body} /> : <p className="muted">{a.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}…</p>}
      {a.media && /\.pdf$/i.test(a.media) && <p><a href={`/uploads/${a.media}`} target="_blank" rel="noreferrer">Document joint (PDF)</a></p>}
      <div className="row" style={{ marginTop: '.5rem' }}>
        {a.type === 'event' && <button className={`btn sm ${a.my_rsvp ? 'green' : ''}`} onClick={rsvp}>{a.my_rsvp ? 'Participation confirmée' : 'Je participe'} · {a.rsvp_count}</button>}
        <button className={`btn sm ghost`} onClick={reshare}>{a.my_reshare ? 'Republié' : 'Republier'} · {a.share_count}</button>
        <button className="btn sm ghost" onClick={share}>Partager</button>
        {!full && <Link className="btn sm ghost" to={`/annonces/${a.id}`}>Lire</Link>}
      </div>
    </article>
  );
}

function Announcements() {
  const [q, set, setQ] = useQueryState({ q: '', type: '', page: 1 });
  const state = useLoad(() => get('/announcements', { ...q, limit: 8 }), [q]);
  return (
    <div className="stack">
      <h1>Annonces & événements</h1>
      <div className="filters">
        <div className="wide"><Debounced type="search" placeholder="Rechercher dans l'archive…" value={q.q} onChange={(v) => set({ q: v })} /></div>
        <select aria-label="Filtrer par type" value={q.type} onChange={(e) => set({ type: e.target.value })}><option value="">Tout</option><option value="announcement">Annonces</option><option value="event">Événements</option></select>
      </div>
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <>{d.items.map((a) => <AnnouncementCard key={a.id} a={a} onChange={state.reload} />)}<Pager data={d} onPage={(page) => setQ({ ...q, page })} /></>
      )}</Async>
    </div>
  );
}

function AnnouncementPage() {
  const { id } = useParams();
  const state = useLoad(() => get(`/announcements/${id}`), [id]);
  return <div className="stack"><Link to="/annonces">← Toutes les annonces</Link><Async state={state}>{(a) => <AnnouncementCard a={a} full onChange={state.reload} />}</Async></div>;
}

/* ================= Accueil ================= */
function Dashboard() {
  const { user } = useAuth();
  const mine = useLoad(() => get('/contributions/mine'), []);
  const anns = useLoad(() => get('/announcements', { limit: 3 }), []);
  const elections = useLoad(() => get('/elections'), []);
  const open = elections.data?.filter((e) => e.status === 'open') || [];
  const c = mine.data;
  return (
    <div className="stack">
      <div><h1>Bonjour {user.first_name} </h1><p className="muted">Bienvenue sur la plateforme de la Jeunesse d'EDJAMBO.</p></div>
      {c && (
        <div className={`alert ${c.current_status === 'approved' ? 'green' : c.current_status === 'pending' ? 'amber' : 'red'}`}>
          <div className="row between">
            <span>Cotisation de {fmtMonth(c.current_month)} : <b>{c.current_status === 'approved' ? 'validée' : c.current_status === 'pending' ? 'en cours de vérification' : 'non réglée'}</b></span>
            {c.current_status === 'unpaid' && <Link className="btn sm" to="/cotisations">Payer maintenant</Link>}
          </div>
        </div>
      )}
      {open.map((e) => (
        <div key={e.id} className="alert violet"><div className="row between"><span>Vote en cours : <b>{e.title}</b></span>
          <Link className="btn sm" to={`/elections/${e.id}`}>{e.has_voted ? 'Voir' : 'Voter'}</Link></div></div>
      ))}
      <div className="section-title"><h2>Dernières annonces</h2><Link to="/annonces">Tout voir →</Link></div>
      <Async state={anns} empty={(d) => !d.items.length}>{(d) => d.items.map((a) => <AnnouncementCard key={a.id} a={a} onChange={anns.reload} />)}</Async>
    </div>
  );
}

/* ================= Cotisations ================= */
function YearGrid({ items }) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const cur = now.toISOString().slice(0, 7);
  const by = {};
  items.forEach((c) => { if (c.month.startsWith(String(year)) && (!by[c.month] || c.status === 'approved' || (c.status === 'pending' && by[c.month] !== 'approved'))) by[c.month] = c.status; });
  const labels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
  const paid = Object.values(by).filter((s) => s === 'approved').length;
  return (
    <section className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Mon année {year}</h2><span className="muted small">{paid} mois validé(s)</span></div>
      <div className="year-grid">
        {labels.map((l, i) => {
          const m = `${year}-${String(i + 1).padStart(2, '0')}`;
          const st = by[m] || (m > cur ? 'future' : m === cur ? 'due' : 'missed');
          return <div key={m} className={`ym ${st}`}><b>{l}</b><small>{{ approved: 'Payé', pending: 'En cours', rejected: 'Rejeté', future: '', due: 'À payer', missed: 'Non payé' }[st]}</small></div>;
        })}
      </div>
    </section>
  );
}

function Contributions() {
  const toast = useToast();
  const mine = useLoad(() => get('/contributions/mine'), []);
  const methods = useLoad(() => get('/payment-methods'), []);
  const settings = useLoad(() => get('/contribution-settings'), []);
  const [proof, setProof] = useState(null);
  const [f, setF] = useState({ month: '', method_id: '', amount: '', reference: '' });
  const [file, setFile] = useState(null);
  const [sms, setSms] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const c = mine.data;

  /** Analyse le SMS collé et pré-remplit le formulaire (moyen de paiement, montant, référence). */
  const analyze = async () => {
    setAnalyzing(true); setErr('');
    try {
      const a = await post('/contributions/parse-sms', { text: sms });
      setAnalysis(a);
      setF((p) => ({ ...p, method_id: a.suggested.method_id ? String(a.suggested.method_id) : p.method_id, amount: p.amount || (a.parsed.amount ? String(a.parsed.amount) : ''), reference: p.reference || a.parsed.reference || '' }));
    } catch (e) { setErr(e.message); } finally { setAnalyzing(false); }
  };

  const months = c ? [0, 1, 2, 3].map((k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); }) : [];
  const taken = new Set((c?.items || []).filter((x) => x.status !== 'rejected').map((x) => x.month));
  const free = months.filter((m) => !taken.has(m));

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (file && file.size > 5 * 1024 * 1024) return setErr('Fichier trop volumineux (5 Mo maximum)');
    const form = new FormData();
    form.append('month', f.month || free[0]);
    form.append('method_id', f.method_id || methods.data[0]?.id);
    if (f.amount) form.append('amount', f.amount);
    if (f.reference) form.append('reference', f.reference);
    if (sms.trim()) form.append('sms_text', sms.trim());
    if (file) form.append('proof', file);
    setBusy(true);
    try {
      await upload('/contributions', form);
      toast('Preuve envoyée, en attente de vérification ');
      setF({ month: '', method_id: '', amount: '', reference: '' }); setFile(null); setSms(''); setAnalysis(null); e.target.reset(); mine.reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Numéro copié '); } catch { /* */ } };

  return (
    <div className="stack">
      <h1>Mes cotisations</h1>
      <Async state={mine}>{(d) => (
        <div className={`alert ${d.up_to_date ? 'green' : 'amber'}`}>
          {d.up_to_date ? 'Votre cotisation est à jour : vous pouvez voter.' : 'Cotisation non à jour : vous ne pouvez pas voter tant qu\'elle n\'est pas validée.'}
          {' '}Montant mensuel : <b>{fmtMoney(settings.data?.monthly_amount)}</b>
        </div>
      )}</Async>

      <Async state={mine}>{(d) => <YearGrid items={d.items} />}</Async>

      <section>
        <h2>1. Payer sur l'un de ces comptes</h2>
        <Async state={methods} empty={(d) => !d.length}>{(d) => (
          <div className="cards three">{d.map((m) => (
            <div key={m.id} className="pay-card">
              <Badge s={m.type === 'bank' ? 'draft' : 'event'}>{m.type === 'bank' ? 'Banque' : 'Mobile Money'}</Badge>
              <h3 style={{ marginTop: '.4rem' }}>{m.label}</h3>
              <div className="num">{m.account_number}</div>
              <div className="muted small">{m.account_name}</div>
              {m.details && <div className="small">{m.details}</div>}
              <button className="btn ghost sm" style={{ marginTop: '.5rem' }} onClick={() => copy(m.account_number)}>Copier</button>
            </div>
          ))}</div>
        )}</Async>
      </section>

      <section className="card">
        <h2>2. Envoyer ma preuve de paiement</h2>
        {free.length === 0 && c ? <Empty>Tous vos mois récents sont déjà soumis ou validés </Empty> : (
          <form className="stack" onSubmit={submit}>
            {err && <div className="alert red">{err}</div>}
            <div className="grid2">
              <Field label="Mois concerné"><select value={f.month || free[0] || ''} onChange={(e) => setF({ ...f, month: e.target.value })}>{free.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}</select></Field>
              <Field label="Moyen de paiement utilisé"><select value={f.method_id || methods.data?.[0]?.id || ''} onChange={(e) => setF({ ...f, method_id: e.target.value })}>{(methods.data || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
              <Field label="Montant (FCFA)"><input type="number" min="1" placeholder={settings.data?.monthly_amount} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
              <Field label="Référence de la transaction"><input type="text" maxLength={80} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
            </div>
            <Field label="SMS de confirmation (Mobile Money)" hint="Copiez-collez le SMS reçu : nous lisons le montant et la référence, et la validation est plus rapide.">
              <textarea rows={3} maxLength={1000} placeholder="Ex. : Vous avez envoyé 1000 FCFA à … ID de transaction : …" value={sms} onChange={(e) => { setSms(e.target.value); setAnalysis(null); }} />
            </Field>
            {sms.trim().length >= 10 && <div><button type="button" className="btn ghost sm" onClick={analyze} disabled={analyzing}>{analyzing ? 'Analyse…' : 'Analyser le SMS'}</button></div>}
            {analysis && <SmsAnalysis a={analysis} />}
            <Field label="Capture ou photo de la confirmation" hint="JPG, PNG ou PDF — 5 Mo max. Au choix : capture, SMS ou référence de transaction."><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
            <button className="btn" disabled={busy || !methods.data?.length}>{busy ? 'Envoi…' : 'Envoyer la preuve'}</button>
          </form>
        )}
      </section>

      <section>
        <h2>Historique</h2>
        <Async state={mine} empty={(d) => !d.items.length}>{(d) => (
          <div className="table-wrap"><table>
            <thead><tr><th>Mois</th><th>Montant</th><th>Moyen</th><th>Référence</th><th>Statut</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id}>
                <td>{fmtMonth(x.month)}</td><td className="nowrap">{fmtMoney(x.amount)}</td><td>{x.method_label}</td><td>{x.reference || '—'}</td>
                <td><Badge s={x.status} />{x.reject_reason && <div className="small muted">{x.reject_reason}</div>}</td>
                <td>{x.has_proof ? <button className="link" onClick={() => setProof(x.id)}>Voir</button> : ''}</td>
              </tr>
            ))}</tbody></table></div>
        )}</Async>
      </section>
      {proof && <Modal title="Preuve de paiement" onClose={() => setProof(null)} wide><ProofViewer id={proof} /></Modal>}
    </div>
  );
}

/* ================= Annuaire ================= */
function Directory() {
  const [q, set, setQ] = useQueryState({ q: '', neighborhood: '', page: 1 });
  const hoods = useLoad(() => get('/members/neighborhoods'), []);
  const state = useLoad(() => get('/members', { ...q, limit: 24 }), [q]);
  return (
    <div className="stack">
      <h1>Annuaire des membres</h1>
      <div className="filters">
        <div className="wide"><Debounced type="search" placeholder="Rechercher un membre…" value={q.q} onChange={(v) => set({ q: v })} /></div>
        <select aria-label="Filtrer par quartier" value={q.neighborhood} onChange={(e) => set({ neighborhood: e.target.value })}><option value="">Tous les quartiers</option>{(hoods.data || []).map((h) => <option key={h}>{h}</option>)}</select>
      </div>
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <>
          <div className="cards three">{d.items.map((m) => (
            <Link key={m.id} to={`/membres/${m.id}`} className="card flat row" style={{ color: 'inherit' }}>
              <Avatar u={m} size={46} /><div className="grow"><b>{fullName(m)}</b><div className="muted small row" style={{ gap: '.25rem' }}><Icon name="map-pin" size={13} /> {m.neighborhood}</div></div>
            </Link>
          ))}</div>
          <Pager data={d} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}</Async>
    </div>
  );
}

function MemberProfile() {
  const { id } = useParams();
  const state = useLoad(() => get(`/members/${id}`), [id]);
  return (
    <div className="stack"><Link to="/membres">← Annuaire</Link>
      <Async state={state}>{(m) => (
        <div className="card stack">
          <div className="row"><Avatar u={m} size={72} /><div><h1 style={{ margin: 0 }}>{fullName(m)}</h1><div className="muted">{m.neighborhood} · membre depuis {fmtDate(m.created_at)}</div></div></div>
          {m.email && <div className="small">{m.email} · {m.phone || '—'} · {m.age} ans <Badge s={m.status} /></div>}
          <h3>Annonces republiées</h3>
          {m.reshares.length ? <ul>{m.reshares.map((r) => <li key={r.id}><Link to={`/annonces/${r.id}`}>{r.title}</Link> <span className="muted small">{fmtDate(r.created_at)}</span></li>)}</ul> : <p className="muted">Aucune.</p>}
          {m.contributions && <><h3>Cotisations</h3><div className="row">{m.contributions.slice(0, 12).map((c) => <span key={c.id} className="row small"><span>{c.month}</span><Badge s={c.status} /></span>)}</div></>}
        </div>
      )}</Async>
    </div>
  );
}

/* ================= Profil ================= */
/** Consentement aux notifications par SMS / WhatsApp (désactivé par défaut, modifiable à tout moment). */
function NotificationPrefs() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const ch = useLoad(() => get('/notifications/channels'), []);
  const [busy, setBusy] = useState(false);
  const save = async (patch) => {
    setBusy(true);
    try {
      await put('/auth/me/notification-prefs', { sms_optin: user.sms_optin, whatsapp_optin: user.whatsapp_optin, ...patch });
      await reload();
      toast('Préférences enregistrées');
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const c = ch.data;
  return (
    <section className="card stack">
      <h2>Notifications par SMS et WhatsApp</h2>
      {!user.phone && <div className="alert amber"><Icon name="info" size={18} /> Ajoutez un numéro de téléphone à votre profil pour activer les SMS et WhatsApp.</div>}
      <p className="muted" style={{ margin: 0 }}>Recevez sur votre téléphone les messages importants, même sans ouvrir l'application. Vous pouvez arrêter à tout moment.</p>
      {c && <p className="small" style={{ margin: 0 }}>Messages concernés : {c.events.length ? c.events.join(', ') : 'aucun pour le moment'}.</p>}
      {c?.simulated && <div className="alert violet small"><Icon name="info" size={16} /> Mode démonstration : aucun message réel n'est envoyé pour l'instant.</div>}
      <label className="checkbox"><input type="checkbox" disabled={busy || !user.phone || !c?.sms} checked={!!user.sms_optin} onChange={(e) => save({ sms_optin: e.target.checked })} /> Recevoir des SMS {c && !c.sms && <span className="muted small">(indisponible)</span>}</label>
      <label className="checkbox"><input type="checkbox" disabled={busy || !user.phone || !c?.whatsapp} checked={!!user.whatsapp_optin} onChange={(e) => save({ whatsapp_optin: e.target.checked })} /> Recevoir des messages WhatsApp {c && !c.whatsapp && <span className="muted small">(indisponible)</span>}</label>
    </section>
  );
}

/** Droits sur les données personnelles : copie complète et suppression (anonymisation) du compte. */
function MyData() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const exportData = async () => { try { await download('/auth/me/export', null, 'mes-donnees-edjambo.json'); } catch (e) { toast(e.message, 'err'); } };
  const remove = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api('/auth/me', { method: 'DELETE', body: { password: pw } }); await logout(); toast('Votre compte a été supprimé'); nav('/'); }
    catch (er) { toast(er.message, 'err'); setBusy(false); }
  };
  return (
    <section className="card stack">
      <h2>Mes données</h2>
      <p className="muted" style={{ margin: 0 }}>Vous gardez la maîtrise de vos informations. <Link to="/confidentialite" target="_blank">Lire la politique de confidentialité</Link>.</p>
      <div className="row">
        <button className="btn ghost" onClick={exportData}><Icon name="file" size={16} /> Télécharger mes données</button>
        {user.role === 'member' && <button className="btn ghost danger" onClick={() => setOpen(true)}><Icon name="trash" size={16} /> Supprimer mon compte</button>}
      </div>
      {open && (
        <Modal title="Supprimer mon compte" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={remove}>
            <div className="alert red"><Icon name="alert" size={18} /> <span>Cette action est <b>définitive</b>. Votre nom, vos coordonnées, votre photo et vos messages privés seront effacés. Vos cotisations déjà enregistrées et vos contributions au forum sont conservées <b>sans votre identité</b> (« Ancien membre »).</span></div>
            <Field label="Votre mot de passe"><PasswordInput required autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Tapez SUPPRIMER pour confirmer"><input type="text" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" /></Field>
            <button className="btn red" disabled={busy || word.trim().toUpperCase() !== 'SUPPRIMER' || !pw}>{busy ? 'Suppression…' : 'Supprimer définitivement mon compte'}</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function Profile() {
  const { user, reload, applySession } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ first_name: user.first_name, last_name: user.last_name, email: user.email || '', phone: user.phone || '', age: user.age || '', neighborhood: user.neighborhood || '' });
  const [photo, setPhoto] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr('');
    const form = new FormData();
    Object.entries(f).forEach(([k, v]) => form.append(k, v));
    if (photo) form.append('photo', photo);
    try { await upload('/auth/me', form, 'PUT'); await reload(); toast('Profil mis à jour '); } catch (e) { setErr(e.message); }
  };
  const changePw = async (e) => {
    e.preventDefault();
    try { applySession(await put('/auth/me/password', pw)); setPw({ current: '', next: '' }); toast('Mot de passe modifié. Vos autres appareils ont été déconnectés.'); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <h1>Mon profil</h1>
      <form className="card stack" onSubmit={save}>
        <div className="row"><Avatar u={user} size={64} /><div><Badge s={user.status} /> <Badge s={user.role === 'member' ? 'active' : user.role}>{user.role === 'member' ? 'Membre' : undefined}</Badge></div></div>
        {err && <div className="alert red">{err}</div>}
        <div className="grid2">
          <Field label="Prénom"><input type="text" value={f.first_name} onChange={set('first_name')} required /></Field>
          <Field label="Nom"><input type="text" value={f.last_name} onChange={set('last_name')} required /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Téléphone"><input type="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Âge"><input type="number" value={f.age} onChange={set('age')} /></Field>
          <Field label="Quartier"><input type="text" value={f.neighborhood} onChange={set('neighborhood')} /></Field>
        </div>
        <Field label="Changer de photo" hint="JPG ou PNG, 5 Mo max"><input type="file" accept="image/jpeg,image/png" onChange={(e) => setPhoto(e.target.files[0] || null)} /></Field>
        <button className="btn">Enregistrer</button>
      </form>
      <NotificationPrefs />
      <MyData />
      <form className="card stack" onSubmit={changePw}>
        <h2>Mot de passe</h2>
        <div className="grid2">
          <Field label="Mot de passe actuel"><PasswordInput required autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nouveau mot de passe" hint="8 caractères min., lettres et chiffres"><PasswordInput meter required autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        </div>
        <button className="btn ghost">Modifier le mot de passe</button>
      </form>
    </div>
  );
}

/* ================= Notifications ================= */
function Notifications() {
  const { setUnread } = useAuth();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const state = useLoad(() => get('/notifications', { page, limit: 20 }), [page]);
  const open = async (n) => { if (!n.is_read) { await post(`/notifications/${n.id}/read`); setUnread((u) => Math.max(0, u - 1)); } if (n.link) nav(n.link); else state.reload(); };
  const readAll = async () => { await post('/notifications/read-all'); setUnread(0); state.reload(); };
  const icon = { registration: 'user', payment: 'wallet', announcement: 'megaphone', event: 'calendar', election: 'vote', proposal: 'bulb', reply: 'chat', reminder: 'clock', security: 'shield', message: 'message', report: 'flag' };
  return (
    <div className="stack">
      <div className="row between"><h1>Notifications</h1><button className="btn ghost sm" onClick={readAll}>Tout marquer comme lu</button></div>
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <>{d.items.map((n) => (
          <div key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => open(n)} onKeyDown={(e) => e.key === 'Enter' && open(n)}>
            <span className="notif-ico"><Icon name={icon[n.type] || 'bell'} size={20} /></span>
            <div className="grow"><b>{n.title}</b>{n.body && <div className="muted small">{n.body}</div>}<div className="muted small">{fmtDateTime(n.created_at)}</div></div>
          </div>
        ))}<Pager data={d} onPage={setPage} /></>
      )}</Async>
    </div>
  );
}

export default function Member({ page }) {
  return {
    dashboard: <Dashboard />, announcements: <Announcements />, announcement: <AnnouncementPage />, contributions: <Contributions />,
    directory: <Directory />, memberProfile: <MemberProfile />, profile: <Profile />, notifications: <Notifications />,
  }[page];
}
