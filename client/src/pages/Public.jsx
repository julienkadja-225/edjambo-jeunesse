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
      <footer className="land-foot"><Logo size={28} /> <span>© {new Date().getFullYear()} Jeunesse d'EDJAMBO</span><Link to="/confidentialite">Confidentialité</Link></footer>
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
  const [terms, setTerms] = useState(false);
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
    form.append('accept_terms', '1');
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
        <label className="checkbox terms"><input type="checkbox" required checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span>J'ai lu et j'accepte la <Link to="/confidentialite" target="_blank">politique de confidentialité</Link>.</span></label>
        <button className="btn block lg" disabled={busy || !terms}>{busy ? 'Envoi…' : "M'inscrire"}</button>
      </form>
    </AuthShell>
  );
}


/* ---------- Politique de confidentialité ---------- */
function Privacy() {
  const Sec = ({ t, children }) => <section><h2>{t}</h2>{children}</section>;
  return (
    <div className="landing">
      <header className="land-nav"><Link to="/" className="brand"><Logo /> Jeunesse d'EDJAMBO</Link><Link to="/connexion" className="btn ghost sm">Se connecter</Link></header>
      <article className="legal">
        <h1>Politique de confidentialité</h1>
        <p className="muted">Dernière mise à jour : {new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}. Texte à faire valider et compléter par le bureau de la jeunesse (coordonnées du responsable, durées de conservation).</p>
        <Sec t="Qui est responsable de vos données ?">
          <p>Le bureau de la Jeunesse d'EDJAMBO, qui gère cette plateforme pour ses membres. Pour toute question ou demande, adressez-vous à un administrateur de la jeunesse ou au bureau.</p>
        </Sec>
        <Sec t="Quelles données collectons-nous ?">
          <ul>
            <li><b>Votre profil</b> : nom, prénom, âge, quartier, photo (facultative), téléphone et/ou email.</li>
            <li><b>Vos cotisations</b> : mois, montant, moyen de paiement, référence, preuve de paiement ou SMS de confirmation que vous nous transmettez.</li>
            <li><b>Votre activité</b> : messages du forum et propositions, réponses, votes sur les propositions, participation aux événements.</li>
            <li><b>Vos messages privés</b> : conversations avec d'autres membres.</li>
            <li><b>Vos votes aux élections</b> : secrets. Nous enregistrons seulement <i>que</i> vous avez voté, jamais <i>pour qui</i>.</li>
            <li><b>Votre consentement</b> aux notifications par SMS / WhatsApp, et la date de votre acceptation de ce texte.</li>
          </ul>
        </Sec>
        <Sec t="Pourquoi ?">
          <p>Gérer l'association : valider les inscriptions, suivre les cotisations et la caisse, organiser les élections, vous informer des activités et permettre aux jeunes d'échanger. Vos données ne sont ni vendues ni utilisées à des fins publicitaires.</p>
        </Sec>
        <Sec t="Qui peut voir quoi ?">
          <ul>
            <li>Les membres voient votre nom, votre quartier et votre photo dans l'annuaire. Vos coordonnées ne sont visibles que de l'équipe d'administration.</li>
            <li>Les finances sont publiées sous forme de totaux : <b>aucun nom de cotisant n'est affiché</b>.</li>
            <li>Les administrateurs voient vos preuves de paiement, uniquement selon leur rôle. Chaque action sensible est inscrite dans un journal.</li>
            <li><b>Vos messages privés ne sont pas lisibles par les administrateurs.</b> Seul un message que l'un des participants <i>signale</i> (et les deux précédents) est transmis à la modération.</li>
            <li>Si l'envoi d'emails ou de SMS est activé, votre numéro ou votre adresse est transmis au prestataire d'envoi uniquement pour acheminer le message.</li>
          </ul>
        </Sec>
        <Sec t="SMS et WhatsApp">
          <p>Ces notifications sont <b>désactivées par défaut</b>. Vous les activez vous-même dans votre profil et pouvez les arrêter à tout moment.</p>
        </Sec>
        <Sec t="Vos droits">
          <ul>
            <li><b>Accès et copie</b> : depuis « Mon profil → Mes données », téléchargez toutes vos données.</li>
            <li><b>Rectification</b> : modifiez votre profil à tout moment.</li>
            <li><b>Effacement</b> : « Mon profil → Supprimer mon compte » efface vos données personnelles (nom, contacts, photo, messages privés). Les écritures de cotisation (obligation de comptabilité de l'association) et vos contributions au forum sont conservées <i>sans lien avec votre identité</i>, sous la mention « Ancien membre ».</li>
            <li><b>Opposition</b> : retirez votre consentement aux SMS / WhatsApp quand vous le souhaitez.</li>
          </ul>
        </Sec>
        <Sec t="Sécurité">
          <p>Mots de passe protégés (hachage), sessions à durée limitée, blocage après plusieurs échecs de connexion, accès aux preuves de paiement restreint, sauvegardes régulières. Aucun système n'est infaillible : choisissez un mot de passe solide et ne le partagez jamais.</p>
        </Sec>
        <Sec t="Conservation">
          <p>Vos données sont conservées tant que votre compte existe. Les données techniques (sessions, notifications lues, journaux d'envoi) sont nettoyées automatiquement.</p>
        </Sec>
        <p><Link className="btn" to="/inscription">Retour à l'inscription</Link></p>
      </article>
    </div>
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
  return { landing: <Landing />, login: <Login />, register: <Register />, shared: <Shared />, privacy: <Privacy />, forgot: <Forgot />, reset: <Reset />, forceChange: <ForceChange /> }[page];
}
