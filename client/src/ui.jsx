import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBlobUrl } from './api.js';
import Icon from './icons.jsx';

/* ---------- Formats ---------- */
const dtf = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dtf2 = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (d) => (d ? dtf.format(new Date(d)) : '—');
export const fmtDateTime = (d) => (d ? dtf2.format(new Date(d)) : '—');
export const fmtMoney = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
export const fmtMonth = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
export const fullName = (o, p = '') => `${o[p + 'first_name'] || ''} ${o[p + 'last_name'] || ''}`.trim();
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/* ---------- Données ---------- */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => id === seq.current && setState({ data, loading: false, error: null }))
      .catch((error) => id === seq.current && setState({ data: null, loading: false, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

/* ---------- Toasts & confirmations ---------- */
const ToastCtx = createContext(() => {});
const ConfirmCtx = createContext(async () => true);
export const useToast = () => useContext(ToastCtx);
/** const confirm = useConfirm(); if (await confirm({ title, message, confirmLabel, danger })) … */
export const useConfirm = () => useContext(ConfirmCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const [dlg, setDlg] = useState(null);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setItems((l) => [...l, { id, msg, type }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 4500);
  }, []);
  const confirm = useCallback((opts) => new Promise((resolve) => setDlg({ ...opts, resolve })), []);
  const close = (v) => { dlg.resolve(v); setDlg(null); };
  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        {dlg && (
          <Modal title={dlg.title || 'Confirmation'} onClose={() => close(false)}>
            <div className="stack">
              {dlg.message && <p style={{ margin: 0 }}>{dlg.message}</p>}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => close(false)}>Annuler</button>
                <button className={`btn ${dlg.danger ? 'red' : ''}`} autoFocus onClick={() => close(true)}>{dlg.confirmLabel || 'Confirmer'}</button>
              </div>
            </div>
          </Modal>
        )}
        <div className="toasts" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast ${t.type}`}><Icon name={t.type === 'err' ? 'alert' : 'check-circle'} size={18} />{t.msg}</div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

/* ---------- Badges ---------- */
const BADGES = {
  pending: ['En attente', 'amber'], active: ['Actif', 'green'], suspended: ['Suspendu', 'red'], inactive: ['Inactif', 'gray'],
  approved: ['Validé', 'green'], rejected: ['Rejeté', 'red'], unpaid: ['Non payé', 'red'], paid: ['À jour', 'green'],
  draft: ['Brouillon', 'gray'], open: ['Ouvert', 'green'], closed: ['Clôturé', 'amber'], published: ['Résultats publiés', 'violet'],
  event: ['Événement', 'orange'], announcement: ['Annonce', 'violet'], admin: ['Admin', 'violet'], super_admin: ['Super Admin', 'orange'],
};
export function Badge({ s, children }) {
  const [label, color] = BADGES[s] || [s, 'gray'];
  return <span className={`badge ${color}`}>{children || label}</span>;
}

/* ---------- Divers ---------- */
export function Avatar({ u, size = 40 }) {
  const initials = ((u.first_name?.[0] || '') + (u.last_name?.[0] || '')).toUpperCase();
  const hue = ((u.id || 0) * 47) % 360;
  return u.photo ? (
    <img className="avatar" style={{ width: size, height: size }} src={`/uploads/${u.photo}`} alt="" loading="lazy" />
  ) : (
    <span className="avatar" style={{ width: size, height: size, background: `hsl(${hue} 70% 45%)`, fontSize: size * 0.38 }}>{initials}</span>
  );
}

export const Spinner = () => <div className="spinner" aria-label="Chargement" />;
export const Empty = ({ children = 'Rien à afficher pour le moment.' }) => <div className="empty">{children}</div>;
export const ErrorBox = ({ error, retry }) => (
  <div className="alert red">
    {error?.message || 'Erreur'} {retry && <button className="link" onClick={retry}>Réessayer</button>}
  </div>
);

export function Async({ state, children, empty }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <ErrorBox error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  if (empty && empty(state.data)) return <Empty />;
  return children(state.data);
}

export function Pager({ data, onPage }) {
  if (!data || data.pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn ghost sm" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>← Précédent</button>
      <span>Page {data.page} / {data.pages} · {data.total.toLocaleString('fr-FR')} résultats</span>
      <button className="btn ghost sm" disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)}>Suivant →</button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="x" size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

export function Stat({ label, value, sub, tone = 'violet', to, icon }) {
  const inner = (
    <>
      {icon && <span className="stat-icon"><Icon name={icon} size={22} /></span>}
      <div className="stat-value">{value}</div><div className="stat-label">{label}</div>{sub && <div className="stat-sub">{sub}</div>}
    </>
  );
  return to ? <Link className={`stat ${tone}`} to={to}>{inner}</Link> : <div className={`stat ${tone}`}>{inner}</div>;
}

export function Debounced({ value, onChange, delay = 350, ...rest }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onChange(v), delay);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line
  return <input {...rest} value={v} onChange={(e) => setV(e.target.value)} />;
}

/* ---------- Éditeur de texte riche (sans dépendance) ---------- */
export function RichEditor({ value, onChange }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = value || ''; }, []); // eslint-disable-line
  const cmd = (c, arg) => { ref.current.focus(); document.execCommand(c, false, arg); onChange(ref.current.innerHTML); };
  return (
    <div className="rte">
      <div className="rte-bar">
        <button type="button" onClick={() => cmd('bold')}><b>G</b></button>
        <button type="button" onClick={() => cmd('italic')}><i>I</i></button>
        <button type="button" onClick={() => cmd('underline')}><u>S</u></button>
        <button type="button" onClick={() => cmd('formatBlock', 'h3')}>Titre</button>
        <button type="button" onClick={() => cmd('insertUnorderedList')}>• Liste</button>
        <button type="button" onClick={() => cmd('insertOrderedList')}>1. Liste</button>
        <button type="button" onClick={() => { const u = prompt('Adresse du lien (https://…)'); if (u) cmd('createLink', u); }}>Lien</button>
      </div>
      <div ref={ref} className="rte-area prose" contentEditable suppressContentEditableWarning onInput={() => onChange(ref.current.innerHTML)} />
    </div>
  );
}

/* ---------- Visionneuse de preuve (fichier protégé) ---------- */
export function ProofViewer({ id }) {
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let url;
    fetchBlobUrl(`/contributions/${id}/proof`).then((f) => { url = f.url; setFile(f); }).catch((e) => setErr(e.message));
    return () => url && URL.revokeObjectURL(url);
  }, [id]);
  if (err) return <div className="alert red">{err}</div>;
  if (!file) return <Spinner />;
  return file.type === 'application/pdf'
    ? <iframe className="proof-pdf" src={file.url} title="Preuve de paiement" />
    : <a href={file.url} target="_blank" rel="noreferrer"><img className="proof-img" src={file.url} alt="Preuve de paiement" /></a>;
}

export const Html = ({ html }) => <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;

export function useQueryState(init) {
  const [q, setQ] = useState(init);
  const set = (patch) => setQ((s) => ({ ...s, page: 1, ...patch }));
  return [q, set, setQ];
}

/* ---------- Mot de passe : affichage + jauge de robustesse ---------- */
const LEVELS = ['Trop court', 'Faible', 'Moyen', 'Bon', 'Excellent'];
function strength(p) {
  if (p.length < 8) return 0;
  let s = 1;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[A-Za-z]/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s - 1 || 1);
}
export function PasswordInput({ meter, ...props }) {
  const [show, setShow] = useState(false);
  const lvl = meter && props.value ? strength(String(props.value)) : null;
  return (
    <div>
      <div className="pw-wrap">
        <input {...props} type={show ? 'text' : 'password'} />
        <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
          <Icon name={show ? 'eye-off' : 'eye'} size={18} />
        </button>
      </div>
      {lvl !== null && (
        <div className="meter" aria-live="polite">
          <div className="meter-bars">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= lvl ? `on l${lvl}` : ''} />)}</div>
          <span className="small muted">{LEVELS[lvl]}</span>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

/** Graphique en barres léger (sans dépendance). data : [{ label, value, sub }] */
export function BarChart({ data, format = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="chart" role="img" aria-label="Graphique en barres">
      {data.map((d) => (
        <div key={d.label} className="chart-col" title={`${d.label} : ${format(d.value)}`}>
          <span className="chart-val">{format(d.value)}</span>
          <div className="chart-bar"><i style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }} /></div>
          <span className="chart-lbl">{d.label}</span>
          {d.sub && <span className="chart-sub">{d.sub}</span>}
        </div>
      ))}
    </div>
  );
}
