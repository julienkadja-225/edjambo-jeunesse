import { useState } from 'react';
import { del, download, get, post, put, upload } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../icons.jsx';
import {
  Async, Badge, Debounced, Field, FileViewer, Modal, PageHeader, Pager, Stat, fmtDate, fmtDateTime, fmtMoney, fmtMonth,
  fullName, useConfirm, useLoad, useQueryState, useToast,
} from '../ui.jsx';
import { DualBars, ProgressRow } from './Finance.jsx';

const SMS_STATUS = { queued: ['En file', 'amber'], sent: ['Envoyé', 'green'], simulated: ['Simulé', 'violet'], failed: ['Échec', 'red'], skipped: ['Ignoré', 'gray'] };
const StatusPill = ({ s }) => <span className={`badge ${SMS_STATUS[s]?.[1] || 'gray'}`}>{SMS_STATUS[s]?.[0] || s}</span>;

function Reason({ title, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}>
        <Field label="Motif (transmis à l'auteur de la dépense)"><textarea required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn red">Rejeter la dépense</button>
      </form>
    </Modal>
  );
}

/* ====================================================================== */
/*  Finances (responsables financiers)                                      */
/* ====================================================================== */
function ExpenseForm({ item, meta, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({
    amount: item?.amount || '', category: item?.category || 'evenements', description: item?.description || '',
    spent_at: item?.spent_at || new Date().toISOString().slice(0, 10),
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (file && file.size > 5 * 1024 * 1024) return toast('Fichier trop volumineux (5 Mo max)', 'err');
    const form = new FormData();
    Object.entries(f).forEach(([k, v]) => form.append(k, v));
    if (file) form.append('receipt', file);
    setBusy(true);
    try {
      await upload(item ? `/finance/expenses/${item.id}` : '/finance/expenses', form, item ? 'PUT' : 'POST');
      toast(item ? 'Dépense renvoyée pour validation' : 'Dépense enregistrée : un autre responsable doit la valider');
      onDone();
    } catch (er) { toast(er.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title={item ? 'Modifier la dépense' : 'Nouvelle dépense'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid2">
          <Field label="Date de la dépense"><input type="date" required max={new Date().toISOString().slice(0, 10)} value={f.spent_at} onChange={(e) => setF({ ...f, spent_at: e.target.value })} /></Field>
          <Field label="Catégorie"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(meta?.categories || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Montant (FCFA)"><input type="number" min="1" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        </div>
        <Field label="Objet de la dépense"><input type="text" required minLength={5} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Justificatif (facture, reçu)" hint={`JPG, PNG ou PDF — 5 Mo max. Obligatoire au-dessus de ${fmtMoney(meta?.receipt_required_above)}.${item?.has_receipt ? ' Un justificatif existe déjà : laissez vide pour le conserver.' : ''}`}>
          <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
        </Field>
        <button className="btn" disabled={busy}>{busy ? 'Enregistrement…' : item ? 'Renvoyer pour validation' : 'Enregistrer'}</button>
      </form>
    </Modal>
  );
}

function Expenses({ meta, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, set, setQ] = useQueryState({ status: '', category: '', month: '', q: '', page: 1 });
  const state = useLoad(() => get('/finance/expenses', { ...q, limit: 15 }), [q]);
  const [form, setForm] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const refresh = () => { state.reload(); onChanged(); };

  const approve = async (e) => {
    if (!(await confirm({ title: 'Valider cette dépense ?', message: `${fmtMoney(e.amount)} — ${e.description}`, confirmLabel: 'Valider' }))) return;
    try { await post(`/finance/expenses/${e.id}/approve`); toast('Dépense validée'); refresh(); } catch (er) { toast(er.message, 'err'); }
  };
  const reject = async (e, reason) => { try { await post(`/finance/expenses/${e.id}/reject`, { reason }); setRejecting(null); toast('Dépense rejetée'); refresh(); } catch (er) { toast(er.message, 'err'); } };
  const remove = async (e) => {
    if (!(await confirm({ title: 'Supprimer cette dépense ?', message: e.description, danger: true, confirmLabel: 'Supprimer' }))) return;
    try { await del(`/finance/expenses/${e.id}`); refresh(); } catch (er) { toast(er.message, 'err'); }
  };
  const exportCsv = async () => { try { await download('/finance/expenses.csv', { month: q.month }, 'depenses.csv'); } catch (e) { toast(e.message, 'err'); } };

  return (
    <div className="stack">
      <div className="row between">
        <div className="filters" style={{ margin: 0, flex: 1 }}>
          <div className="wide"><Debounced type="search" placeholder="Rechercher une dépense…" value={q.q} onChange={(v) => set({ q: v })} /></div>
          <select aria-label="Filtrer par statut" value={q.status} onChange={(e) => set({ status: e.target.value })}><option value="">Tous statuts</option><option value="pending">À valider</option><option value="approved">Validées</option><option value="rejected">Rejetées</option></select>
          <select aria-label="Filtrer par catégorie" value={q.category} onChange={(e) => set({ category: e.target.value })}><option value="">Toutes catégories</option>{Object.entries(meta?.categories || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input type="month" value={q.month} onChange={(e) => set({ month: e.target.value })} aria-label="Mois" />
        </div>
        <div className="row"><button className="btn ghost" onClick={exportCsv}><Icon name="file" size={16} /> CSV</button><button className="btn" onClick={() => setForm({})}><Icon name="plus" size={16} /> Dépense</button></div>
      </div>
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Objet</th><th className="right">Montant</th><th>Statut</th><th className="hide-mobile">Saisie / validation</th><th /></tr></thead>
            <tbody>{d.items.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{fmtDate(e.spent_at)}</td>
                <td><b>{e.description}</b><div><Badge s="announcement">{e.category_label}</Badge></div></td>
                <td className="right nowrap"><b>{fmtMoney(e.amount)}</b></td>
                <td><Badge s={e.status === 'pending' ? 'pending' : e.status}>{e.status === 'pending' ? 'À valider' : undefined}</Badge>{e.reject_reason && <div className="small muted">{e.reject_reason}</div>}</td>
                <td className="hide-mobile small">Saisie : {e.creator_first} {e.creator_last}{e.reviewer_first && <><br />{e.status === 'approved' ? 'Validée' : 'Traitée'} : {e.reviewer_first} {e.reviewer_last}</>}</td>
                <td><div className="row" style={{ gap: '.3rem' }}>
                  {e.has_receipt ? <button className="btn ghost sm" onClick={() => setReceipt(e)}>Justificatif</button> : null}
                  {e.status === 'pending' && e.created_by !== user.id && <><button className="btn green sm" onClick={() => approve(e)}>Valider</button><button className="btn red sm" onClick={() => setRejecting(e)}>Rejeter</button></>}
                  {e.status === 'pending' && e.created_by === user.id && <span className="muted small">En attente d'un autre responsable</span>}
                  {e.status !== 'approved' && (e.created_by === user.id || user.role === 'super_admin') && <><button className="btn ghost sm" onClick={() => setForm(e)}>{e.status === 'rejected' ? 'Corriger' : 'Modifier'}</button><button className="btn ghost sm" onClick={() => remove(e)} aria-label="Supprimer"><Icon name="trash" size={14} /></button></>}
                </div></td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={2}><b>Total affiché</b></td><td className="right"><b>{fmtMoney(d.sum)}</b></td><td colSpan={3} /></tr></tfoot>
          </table></div>
          <Pager data={d} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}</Async>
      {form && <ExpenseForm item={form.id ? form : null} meta={meta} onClose={() => setForm(null)} onDone={() => { setForm(null); refresh(); }} />}
      {receipt && <Modal title={`Justificatif — ${receipt.description}`} onClose={() => setReceipt(null)} wide><FileViewer path={`/finance/expenses/${receipt.id}/receipt`} /></Modal>}
      {rejecting && <Reason title="Rejeter la dépense" onClose={() => setRejecting(null)} onSubmit={(r) => reject(rejecting, r)} />}
    </div>
  );
}

function Budgets({ meta, onChanged }) {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const sum = useLoad(() => get('/finance/summary'), []);
  const settings = useLoad(() => get('/finance/settings'), []);
  const cur = sum.data?.year;
  const budgets = Object.fromEntries((sum.data?.budgets || []).map((b) => [b.category, b]));
  const saveBudget = async (category, amount) => {
    try { await put('/finance/budgets', { year, category, amount: amount === '' ? 0 : amount }); toast('Budget enregistré'); sum.reload(); onChanged(); } catch (e) { toast(e.message, 'err'); }
  };
  const saveSettings = async (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    try {
      await put('/finance/settings', { opening_balance: d.get('opening_balance'), receipt_required_above: d.get('receipt_required_above'), public_receipts: d.get('public_receipts') === 'on' });
      toast('Paramètres enregistrés'); settings.reload(); sum.reload(); onChanged();
    } catch (er) { toast(er.message, 'err'); }
  };
  return (
    <div className="cards">
      <div className="card stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Budget prévisionnel</h2>
          <input type="number" style={{ width: 100 }} min="2020" max="2100" value={year} onChange={(e) => setYear(parseInt(e.target.value) || year)} aria-label="Année" /></div>
        {year !== cur && <p className="muted small" style={{ margin: 0 }}>Le suivi « dépensé » ci-dessous ne concerne que l'année en cours ({cur}).</p>}
        {Object.entries(meta?.categories || {}).map(([k, label]) => (
          <div key={k} className="stack" style={{ borderBottom: '1px solid var(--line)', paddingBottom: '.6rem' }}>
            {budgets[k] && year === cur ? <ProgressRow label={label} spent={budgets[k].spent} planned={budgets[k].planned} /> : <b>{label}</b>}
            <form className="row" onSubmit={(e) => { e.preventDefault(); saveBudget(k, new FormData(e.target).get('amount')); }}>
              <input name="amount" type="number" min="0" style={{ maxWidth: 160 }} placeholder="Montant prévu" defaultValue={year === cur ? budgets[k]?.planned ?? '' : ''} key={`${year}-${k}-${budgets[k]?.planned}`} />
              <button className="btn ghost sm">Enregistrer</button>
            </form>
          </div>
        ))}
      </div>
      <Async state={settings}>{(s) => (
        <form className="card stack" onSubmit={saveSettings} key={JSON.stringify(s)}>
          <h2>Paramètres</h2>
          <Field label="Solde initial de la caisse (FCFA)" hint="Report des comptes avant l'utilisation de la plateforme."><input type="number" name="opening_balance" defaultValue={s.opening_balance} /></Field>
          <Field label="Justificatif obligatoire à partir de (FCFA)"><input type="number" name="receipt_required_above" min="0" defaultValue={s.receipt_required_above} /></Field>
          <label className="checkbox"><input type="checkbox" name="public_receipts" defaultChecked={s.public_receipts} /> Les membres peuvent consulter les justificatifs des dépenses validées</label>
          <div className="alert violet"><Icon name="info" size={18} /> Une dépense n'est comptabilisée qu'après validation par un responsable différent de celui qui l'a saisie.</div>
          <button className="btn">Enregistrer</button>
        </form>
      )}</Async>
    </div>
  );
}

function ReportTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const rep = useLoad(() => get('/finance/report', { month }), [month]);
  const publish = async () => {
    if (!(await confirm({ title: 'Publier le rapport aux membres ?', message: `Une annonce « Rapport financier — ${fmtMonth(month)} » sera publiée et tous les membres seront notifiés.`, confirmLabel: 'Publier' }))) return;
    try { await post('/finance/report/publish', { month }); toast('Rapport publié dans les annonces'); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <div className="row between">
        <input type="month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Mois" />
        <div className="row"><a className="btn ghost" href={`/finances/rapport?month=${month}`} target="_blank" rel="noreferrer"><Icon name="file" size={16} /> Version imprimable / PDF</a><button className="btn" onClick={publish}><Icon name="megaphone" size={16} /> Publier aux membres</button></div>
      </div>
      <Async state={rep}>{(r) => (
        <div className="stats">
          <Stat label="Solde d'ouverture" value={fmtMoney(r.opening_balance)} />
          <Stat tone="green" label="Cotisations validées" value={fmtMoney(r.income.total)} sub={`${r.income.payers} / ${r.income.active_members} membres (${r.income.rate} %)`} />
          <Stat tone="orange" label="Dépenses validées" value={fmtMoney(r.expenses.total)} sub={`${r.expenses.items.length} ligne(s)`} />
          <Stat tone="dark" label="Solde de clôture" value={fmtMoney(r.closing_balance)} />
        </div>
      )}</Async>
    </div>
  );
}

export function AdminFinance() {
  const [tab, setTab] = useState('expenses');
  const sum = useLoad(() => get('/finance/summary'), []);
  const meta = useLoad(() => get('/finance/meta'), []);
  return (
    <div className="stack">
      <PageHeader title="Finances" subtitle="Dépenses avec double validation, budgets et rapports mensuels." />
      <Async state={sum}>{(s) => (
        <>
          <div className="stats">
            <Stat icon="wallet" tone="green" label="Solde de la caisse" value={fmtMoney(s.balance)} />
            <Stat icon="activity" label="Cotisations du mois" value={fmtMoney(s.month_income)} />
            <Stat icon="file" tone="orange" label="Dépenses du mois" value={fmtMoney(s.month_expenses)} />
            <Stat icon="clock" tone="dark" label="Dépenses à valider" value={s.pending_expenses ?? 0} />
          </div>
          <div className="card"><h2>Recettes et dépenses sur 12 mois</h2><DualBars history={s.history} /></div>
        </>
      )}</Async>
      <div className="chips">
        {[['expenses', 'Dépenses'], ['budgets', 'Budgets et paramètres'], ['report', 'Rapport mensuel']].map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'expenses' && <Expenses meta={meta.data} onChanged={sum.reload} />}
      {tab === 'budgets' && <Budgets meta={meta.data} onChanged={sum.reload} />}
      {tab === 'report' && <ReportTab />}
    </div>
  );
}

/* ====================================================================== */
/*  Passerelle SMS / WhatsApp (Super Admin)                                 */
/* ====================================================================== */
export function SmsGateway() {
  const toast = useToast();
  const confirm = useConfirm();
  const status = useLoad(() => get('/admin/sms/status'), []);
  const [q, set, setQ] = useQueryState({ status: '', channel: '', page: 1 });
  const outbox = useLoad(() => get('/admin/sms/outbox', { ...q, limit: 15 }), [q]);
  const [events, setEvents] = useState(null);
  const refresh = () => { status.reload(); outbox.reload(); };

  const ev = events ?? status.data?.events ?? [];
  const toggle = (k) => setEvents(ev.includes(k) ? ev.filter((x) => x !== k) : [...ev, k]);
  const save = async (e) => {
    e.preventDefault();
    const d = new FormData(e.target);
    try {
      await put('/admin/sms/settings', { events: ev, daily_cap: d.get('daily_cap'), unit_cost: d.get('unit_cost'), default_country_code: d.get('cc') });
      toast('Paramètres enregistrés'); setEvents(null); status.reload();
    } catch (er) { toast(er.message, 'err'); }
  };
  const test = async (channel) => {
    try { const r = await post('/admin/sms/test', { channel }); toast(r.status === 'failed' || r.error ? `Échec : ${r.error}` : r.status === 'simulated' ? 'Test simulé (voir la console du serveur)' : 'Message de test envoyé', r.error ? 'err' : 'ok'); refresh(); } catch (er) { toast(er.message, 'err'); }
  };
  const flush = async () => { const r = await post('/admin/sms/process'); toast(`${r.processed} message(s) traité(s)`); refresh(); };
  const retry = async () => {
    if (!(await confirm({ title: 'Relancer les envois en échec ?', confirmLabel: 'Relancer' }))) return;
    const r = await post('/admin/sms/retry-failed'); toast(`${r.requeued} message(s) remis en file`); refresh();
  };

  return (
    <div className="stack">
      <PageHeader title="Notifications SMS & WhatsApp" subtitle="Envois uniquement aux membres qui ont donné leur accord, pour les événements que vous choisissez.">
        <button className="btn ghost" onClick={flush}>Envoyer la file maintenant</button>
      </PageHeader>
      <Async state={status}>{(s) => (
        <>
          {s.provider.simulated && <div className="alert amber"><Icon name="info" size={18} /> <span><b>Mode simulation</b> : aucun message réel n'est envoyé (ils sont affichés dans la console du serveur). Pour activer l'envoi réel, configurez <code>SMS_PROVIDER</code> (twilio ou webhook) dans <code>server/.env</code> — voir le README.</span></div>}
          {!s.provider.simulated && !s.provider.configured && <div className="alert red"><Icon name="alert" size={18} /> Fournisseur « {s.provider.name} » incomplètement configuré : aucun envoi ne partira.</div>}
          <div className="stats">
            <Stat icon="phone" label="Fournisseur" value={s.provider.name} sub={`SMS ${s.provider.channels.sms ? 'oui' : 'non'} · WhatsApp ${s.provider.channels.whatsapp ? 'oui' : 'non'}`} />
            <Stat icon="users" tone="green" label="Membres consentants" value={s.stats.optin.sms + s.stats.optin.whatsapp} sub={`${s.stats.optin.sms} SMS · ${s.stats.optin.whatsapp} WhatsApp / ${s.stats.optin.members} membres`} />
            <Stat icon="send" tone="orange" label="Messages ce mois" value={s.stats.month.sent + s.stats.month.simulated} sub={`${s.stats.month.failed} échec(s) · ${s.stats.month.skipped} ignoré(s)`} />
            <Stat icon="wallet" tone="dark" label="Coût estimé (ce mois)" value={fmtMoney(s.stats.estimated_cost)} sub={`${fmtMoney(s.stats.unit_cost)} / message`} />
          </div>
          <form className="card stack" onSubmit={save}>
            <h2>Événements envoyés par SMS / WhatsApp</h2>
            <div className="perm-list">{Object.entries(s.event_labels).map(([k, l]) => <label key={k} className="checkbox"><input type="checkbox" checked={ev.includes(k)} onChange={() => toggle(k)} />{l}</label>)}</div>
            <div className="grid2">
              <Field label="Plafond journalier (messages)" hint="Au-delà, les messages sont ignorés pour maîtriser le coût."><input type="number" name="daily_cap" min="0" defaultValue={s.daily_cap} key={s.daily_cap} /></Field>
              <Field label="Coût unitaire estimé (FCFA)"><input type="number" name="unit_cost" min="0" defaultValue={s.stats.unit_cost} key={s.stats.unit_cost} /></Field>
              <Field label="Indicatif pays par défaut"><input type="text" name="cc" defaultValue={s.default_country_code} key={s.default_country_code} /></Field>
            </div>
            <div className="row"><button className="btn">Enregistrer</button>
              <button type="button" className="btn ghost" onClick={() => test('sms')} disabled={!s.provider.channels.sms}>Test SMS vers mon numéro</button>
              <button type="button" className="btn ghost" onClick={() => test('whatsapp')} disabled={!s.provider.channels.whatsapp}>Test WhatsApp</button></div>
            <p className="muted small" style={{ margin: 0 }}>Les rappels de cotisation partent une fois par mois et par membre. Chaque membre peut retirer son consentement à tout moment depuis son profil.</p>
          </form>
        </>
      )}</Async>
      <div className="row between"><h2 style={{ margin: 0 }}>Journal d'envoi</h2><button className="btn ghost sm" onClick={retry}>Relancer les échecs</button></div>
      <div className="filters">
        <select aria-label="Filtrer par statut" value={q.status} onChange={(e) => set({ status: e.target.value })}><option value="">Tous statuts</option>{Object.entries(SMS_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <select aria-label="Filtrer par canal" value={q.channel} onChange={(e) => set({ channel: e.target.value })}><option value="">Tous canaux</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select>
      </div>
      <Async state={outbox} empty={(d) => !d.items.length}>{(d) => (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Destinataire</th><th>Canal</th><th>Message</th><th>Statut</th></tr></thead>
            <tbody>{d.items.map((o) => (
              <tr key={o.id}>
                <td className="nowrap small">{fmtDateTime(o.created_at)}</td>
                <td>{o.first_name ? fullName(o) : '—'}<div className="muted small">{o.to_addr}</div></td>
                <td>{o.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}</td>
                <td className="small" style={{ maxWidth: 340 }}>{o.body}</td>
                <td><StatusPill s={o.status} />{o.error && <div className="small muted">{o.error}{o.attempts ? ` (${o.attempts} essai(s))` : ''}</div>}</td>
              </tr>
            ))}</tbody></table></div>
          <Pager data={d} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}</Async>
    </div>
  );
}
