import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { get, post, put, upload } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon, { Logo } from '../icons.jsx';
import { Async, Badge, Field, Html, PasswordInput, Spinner, fmtDateTime, useLoad } from '../ui.jsx';

/* ---------- Gabarit des pages d'authentification ---------- */
function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-split">
      <aside className="auth-brand">
        <Link to="/" className="brand light"><Logo /> Jeunesse d'EDJAMBO</Link>
        <div>
          <h2>Une jeunesse unie,<br />une ville qui avance.</h2>
          <ul className="auth-points">
            <li><Icon name="vote" /> Élections transparentes et vérifiables</li>
            <li><Icon name="chat" /> Forum et propositions de la communauté</li>
            <li><Icon name="wallet" /> Cotisations suivies en toute clarté</li>
          </ul>
        </div>
        <small>© {new Date().getFullYear()} Jeunesse d'EDJAMBO</small>
      </aside>
      <main className="auth-main">
        <div className="auth-box">
          <Link to="/" className="brand mobile-only"><Logo /> Jeunesse d'EDJAMBO</Link>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
          {children}
          {footer && <p className="muted small auth-footer">{footer}</p>}
        </div>
      </main>
    </div>
  );
}

/* ---------- Accueil public ---------- */
function Landing() {
  const steps = [
    ['1', 'Inscrivez-vous', 'Créez votre profil en quelques minutes.'],
    ['2', 'Validation', "L'équipe d'administration valide votre compte."],
    ['3', 'Participez', 'Forum, votes, événements et cotisations.'],
  ];
  return (
    <div className="landing">
      <header className="land-nav">
        <Link to="/" className="brand"><Logo /> Jeunesse d'EDJAMBO</Link>
        <nav className="row"><Link to="/connexion" className="btn ghost sm">Se connecter</Link><Link to="/inscription" className="btn sm">Rejoindre</Link></nav>
      </header>
      <section className="hero">
        <img className="hero-logo" src="/logo-mark.svg" width="112" height="112" alt="Logo de la jeunesse d'EDJAMBO" />
        <span className="pill">Plateforme officielle de la jeunesse</span>
        <h1>Ensemble, construisons EDJAMBO</h1>
        <p>Échangez, proposez, votez, suivez les événements et gérez votre cotisation : tout ce dont la jeunesse a besoin, au même endroit, en toute transparence.</p>
        <div className="row center">
          <Link to="/inscription" className="btn orange lg">Rejoindre la jeunesse <Icon name="arrow" size={18} /></Link>
          <Link to="/connexion" className="btn ghost lg">J'ai déjà un compte</Link>
        </div>
      </section>
      <section className="features">
        {[
          ['vote', 'Votes démocratiques', 'Un membre, une voix. Bulletins anonymes, reçu individuel et audit public des résultats.'],
          ['chat', 'Forum & propositions', 'Discutez, déposez vos idées et soutenez celles qui comptent pour la communauté.'],
          ['wallet', 'Cotisations simples', 'Payez par Orange Money, MTN Money ou virement, puis envoyez votre preuve en un clic.'],
        ].map(([i, t, d]) => (
          <div className="card feature" key={t}><span className="feat-icon"><Icon name={i} size={24} /></span><h3>{t}</h3><p className="muted">{d}</p></div>
        ))}
      </section>
      <section className="steps">
        <h2>Comment ça marche</h2>
        <div className="steps-grid">{steps.map(([n, t, d]) => <div key={n} className="step"><span className="step-n">{n}</span><h3>{t}</h3><p className="muted">{d}</p></div>)}</div>
      </section>
      <footer className="land-foot"><Logo size={28} /> <span>© {new Date().getFullYear()} Jeunesse d'EDJAMBO · Tous droits réservés</span></footer>
    </div>
  );
}

/* ---------- Connexion ---------- */
function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [f, setF] = useState({ identifier: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const u = await login(f.identifier, f.password);
      nav(u.must_change_password ? '/changer-mot-de-passe' : loc.state?.from || (u.role === 'member' ? '/accueil' : '/admin'), { replace: true });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Bon retour !" subtitle="Connectez-vous pour accéder à votre espace." footer={<>Pas encore membre ? <Link to="/inscription">Créer un compte</Link></>}>
      <form className="stack" onSubmit={submit}>
        {err && <div className="alert red" role="alert">{err}</div>}
        <Field label="Email ou téléphone"><input type="text" autoComplete="username" required autoFocus value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} /></Field>
        <Field label="Mot de passe"><PasswordInput autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <div className="right"><Link to="/mot-de-passe-oublie" state={{ identifier: f.identifier }} className="small">Mot de passe oublié ?</Link></div>
        <button className="btn block lg" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </AuthShell>
  );
}

/* ---------- Mot de passe oublié ---------- */
function Forgot() {
  const loc = useLocation();
  const [identifier, setIdentifier] = useState(loc.state?.identifier || '');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { setRes(await post('/auth/forgot', { identifier })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Mot de passe oublié" subtitle="Saisissez votre email ou téléphone pour recevoir un lien de réinitialisation." footer={<Link to="/connexion">← Retour à la connexion</Link>}>
      {res ? (
        <div className="stack">
          <div className="alert green" role="status">{res.message}</div>
          {res.dev_link && <div className="alert amber"><b>Mode développement</b> (aucun serveur email configuré) :<br /><Link to={res.dev_link.replace(/^https?:\/\/[^/]+/, '')}>Ouvrir le lien de réinitialisation</Link></div>}
          <div className="card flat small">
            <b>Pas d'email enregistré ?</b> Contactez un administrateur de la jeunesse : il pourra vous générer un mot de passe temporaire que vous changerez à la première connexion.
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          {err && <div className="alert red" role="alert">{err}</div>}
          <Field label="Email ou téléphone"><input type="text" required autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></Field>
          <button className="btn block lg" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le lien'}</button>
        </form>
      )}
    </AuthShell>
  );
}

/* ---------- Nouveau mot de passe via lien ---------- */
function Reset() {
  const { token } = useParams();
  const nav = useNavigate();
  const check = useLoad(() => get(`/auth/reset/${token}`), [token]);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (pw !== pw2) return setErr('Les deux mots de passe ne correspondent pas');
    try { await post('/auth/reset', { token, password: pw }); setDone(true); setTimeout(() => nav('/connexion'), 2500); } catch (e) { setErr(e.message); }
  };
  if (check.loading) return <Spinner />;
  return (
    <AuthShell title="Nouveau mot de passe" footer={<Link to="/connexion">← Retour à la connexion</Link>}>
      {done ? <div className="alert green" role="status">Mot de passe modifié. Redirection vers la connexion…</div>
        : !check.data?.valid ? (
          <div className="stack"><div className="alert red">Ce lien est invalide ou a expiré.</div><Link className="btn block" to="/mot-de-passe-oublie">Faire une nouvelle demande</Link></div>
        ) : (
          <form className="stack" onSubmit={submit}>
            {err && <div className="alert red" role="alert">{err}</div>}
            <Field label="Nouveau mot de passe"><PasswordInput meter autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Confirmer le mot de passe"><PasswordInput autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
            <button className="btn block lg">Enregistrer</button>
          </form>
        )}
    </AuthShell>
  );
}

/* ---------- Changement obligatoire (mot de passe temporaire) ---------- */
function ForceChange() {
  const { user, loading, applySession, logout } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  useEffect(() => { if (!loading && !user) nav('/connexion', { replace: true }); }, [loading, user, nav]);
  if (loading || !user) return <Spinner />;
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.next !== f.confirm) return setErr('Les deux mots de passe ne correspondent pas');
    try { applySession(await put('/auth/me/password', { current: f.current, next: f.next })); nav(user.role === 'member' ? '/accueil' : '/admin', { replace: true }); } catch (e) { setErr(e.message); }
  };
  return (
    <AuthShell title="Choisissez votre mot de passe" subtitle="Vous utilisez un mot de passe temporaire. Définissez-en un nouveau pour continuer.">
      <form className="stack" onSubmit={submit}>
        {err && <div className="alert red" role="alert">{err}</div>}
        <Field label="Mot de passe temporaire"><PasswordInput autoComplete="current-password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="Nouveau mot de passe"><PasswordInput meter autoComplete="new-password" required value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="Confirmer"><PasswordInput autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <button className="btn block lg">Valider</button>
        <button type="button" className="btn ghost block" onClick={async () => { await logout(); nav('/'); }}>Se déconnecter</button>
      </form>
    </AuthShell>
  );
}

/* ---------- Inscription ---------- */
function Register() {
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', phone: '', age: '', neighborhood: '', password: '' });
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (photo && photo.size > 5 * 1024 * 1024) return setErr('Photo trop volumineuse (5 Mo maximum)');
    const form = new FormData();
    Object.entries(f).forEach(([k, v]) => v && form.append(k, v));
    if (photo) form.append('photo', photo);
    setBusy(true);
    try { await upload('/auth/register', form); setDone(true); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (done)
    return (
      <AuthShell title="Inscription envoyée">
        <div className="stack">
          <div className="alert green" role="status">Votre demande a bien été reçue. Un administrateur va la valider ; vous serez notifié et pourrez ensuite vous connecter.</div>
          <Link to="/" className="btn block">Retour à l'accueil</Link>
        </div>
      </AuthShell>
    );
  return (
    <AuthShell title="Créer mon profil" subtitle="Rejoignez la communauté des jeunes d'EDJAMBO." footer={<>Déjà membre ? <Link to="/connexion">Se connecter</Link></>}>
      <form className="stack" onSubmit={submit}>
        {err && <div className="alert red" role="alert">{err}</div>}
        <div className="grid2">
          <Field label="Prénom"><input type="text" required value={f.first_name} onChange={set('first_name')} /></Field>
          <Field label="Nom"><input type="text" required value={f.last_name} onChange={set('last_name')} /></Field>
          <Field label="Âge"><input type="number" min="12" max="99" required value={f.age} onChange={set('age')} /></Field>
          <Field label="Quartier"><input type="text" required value={f.neighborhood} onChange={set('neighborhood')} /></Field>
          <Field label="Téléphone"><input type="tel" placeholder="+225…" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Email" hint="Recommandé : permet de récupérer votre mot de passe"><input type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Mot de passe" hint="8 caractères minimum, avec lettres et chiffres"><PasswordInput meter required autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <Field label="Photo (facultative)" hint="JPG ou PNG, 5 Mo max"><input type="file" accept="image/jpeg,image/png" onChange={(e) => setPhoto(e.target.files[0] || null)} /></Field>
        <button className="btn block lg" disabled={busy}>{busy ? 'Envoi…' : "M'inscrire"}</button>
      </form>
    </AuthShell>
  );
}

/** Lien de partage public d'une annonce */
function Shared() {
  const { id } = useParams();
  const state = useLoad(() => get(`/public/announcements/${id}`), [id]);
  return (
    <div className="landing">
      <header className="land-nav"><Link to="/" className="brand"><Logo /> Jeunesse d'EDJAMBO</Link><Link to="/inscription" className="btn sm">Rejoindre</Link></header>
      <div className="shared-wrap">
        <Async state={state}>{(a) => (
          <article className="card">
            {a.media && /\.(jpe?g|png)$/i.test(a.media) && <img className="ann-media" src={`/uploads/${a.media}`} alt="" />}
            <div className="row"><Badge s={a.type} />{a.event_date && <span className="event-date"><Icon name="calendar" size={15} /> {fmtDateTime(a.event_date)}</span>}</div>
            <h1 style={{ marginTop: '.6rem' }}>{a.title}</h1>
            {a.location && <p className="muted row" style={{ gap: '.3rem' }}><Icon name="map-pin" size={16} /> {a.location}</p>}
            <Html html={a.body} />
            <hr className="sep" />
            <p className="muted small">Rejoignez la communauté pour participer.</p>
            <Link className="btn" to="/inscription">Rejoindre la jeunesse</Link>
          </article>
        )}</Async>
      </div>
    </div>
  );
}

export default function Public({ page }) {
  return { landing: <Landing />, login: <Login />, register: <Register />, shared: <Shared />, forgot: <Forgot />, reset: <Reset />, forceChange: <ForceChange /> }[page];
}
