import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Icon, { Logo } from './icons.jsx';
import { Avatar } from './ui.jsx';

function Shell({ items, admin, children }) {
  const { user, logout, unread, msgUnread } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const cur = items.filter((i) => i.to && (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to))).sort((a, b) => b.to.length - a.to.length)[0];
    document.title = `${cur ? cur.label + ' · ' : ''}${admin ? 'Administration' : "Jeunesse d'EDJAMBO"}`;
  }, [loc.pathname, items, admin]);

  const roleLabel = user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Administrateur' : 'Membre';
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Aller au contenu</a>
      <header className="topbar">
        <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Ouvrir le menu"><Icon name="menu" /></button>
        <Link to={admin ? '/admin' : '/accueil'} className="brand mobile-only"><Logo size={30} /> {admin ? 'Administration' : 'Jeunesse EDJAMBO'}</Link>
        <span className="grow" />
        <Link to="/messages" className="icon-btn bell" aria-label={`Messagerie${msgUnread ? ` (${msgUnread} non lus)` : ''}`}>
          <Icon name="message" />{msgUnread > 0 && <span className="dot">{msgUnread > 99 ? '99+' : msgUnread}</span>}
        </Link>
        <Link to="/notifications" className="icon-btn bell" aria-label={`Notifications${unread ? ` (${unread} non lues)` : ''}`}>
          <Icon name="bell" />{unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
        </Link>
        <Link to="/profil" className="top-user" aria-label="Mon profil">
          <Avatar u={user} size={34} /><span className="hide-mobile"><b>{user.first_name}</b><small>{roleLabel}</small></span>
        </Link>
      </header>

      <aside className={`sidebar ${admin ? 'admin' : ''} ${open ? 'open' : ''}`} aria-label="Navigation">
        <div className="row between side-head">
          <Link to={admin ? '/admin' : '/accueil'} className="brand"><Logo /> <span>{admin ? 'Administration' : 'Jeunesse EDJAMBO'}</span></Link>
          <button className="icon-btn menu-btn" onClick={() => setOpen(false)} aria-label="Fermer le menu"><Icon name="x" /></button>
        </div>
        <nav className="side-nav">
          {items.map((it, i) =>
            it.group ? <div key={i} className="grp">{it.group}</div> : (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>
                <Icon name={it.icon} size={19} /><span>{it.label}</span>{it.badge ? <span className="count">{it.badge}</span> : null}
              </NavLink>
            )
          )}
        </nav>
        <span className="grow" />
        <div className="side-user">
          <Avatar u={user} size={36} />
          <div className="grow"><b>{user.first_name} {user.last_name}</b><small>{roleLabel}</small></div>
          <button className="icon-btn" title="Se déconnecter" aria-label="Se déconnecter" onClick={async () => { await logout(); nav('/'); }}><Icon name="logout" size={18} /></button>
        </div>
      </aside>

      <main className="main" id="main" tabIndex={-1}><Outlet /></main>
      {children}
    </div>
  );
}

export function MemberLayout() {
  const { isAdmin, msgUnread } = useAuth();
  const items = [
    { to: '/accueil', icon: 'home', label: 'Accueil', end: true },
    { to: '/annonces', icon: 'megaphone', label: 'Annonces & événements' },
    { to: '/messages', icon: 'message', label: 'Messagerie', badge: msgUnread },
    { to: '/forum', icon: 'chat', label: 'Forum' },
    { to: '/propositions', icon: 'bulb', label: 'Propositions' },
    { to: '/elections', icon: 'vote', label: 'Votes & élections' },
    { to: '/cotisations', icon: 'wallet', label: 'Mes cotisations' },
    { to: '/finances', icon: 'chart', label: 'Finances' },
    { to: '/membres', icon: 'users', label: 'Annuaire' },
    { to: '/profil', icon: 'user', label: 'Mon profil' },
    ...(isAdmin ? [{ group: 'Administration' }, { to: '/admin', icon: 'dashboard', label: 'Espace admin' }] : []),
  ];
  const bottom = [
    ['/accueil', 'home', 'Accueil'], ['/annonces', 'megaphone', 'Annonces'], ['/forum', 'chat', 'Forum'],
    ['/elections', 'vote', 'Votes'], ['/cotisations', 'wallet', 'Cotisation'],
  ];
  return (
    <Shell items={items}>
      <nav className="bottom-nav" aria-label="Navigation rapide">
        {bottom.map(([to, icon, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={icon} size={22} />{label}</NavLink>
        ))}
      </nav>
    </Shell>
  );
}

export function AdminLayout() {
  const { can, isSuper } = useAuth();
  const items = [
    { to: '/admin', icon: 'dashboard', label: "Vue d'ensemble", end: true },
    ...(can('members') ? [{ to: '/admin/membres', icon: 'users', label: 'Membres' }] : []),
    ...(can('payments') ? [{ to: '/admin/paiements', icon: 'check-circle', label: 'Cotisations' }, { to: '/admin/paiement-infos', icon: 'bank', label: 'Infos de paiement' }] : []),
    ...(can('finance') ? [{ to: '/admin/finances', icon: 'chart', label: 'Finances' }] : []),
    ...(can('elections') ? [{ to: '/admin/elections', icon: 'vote', label: 'Élections' }] : []),
    ...(can('announcements') ? [{ to: '/admin/annonces', icon: 'megaphone', label: 'Annonces' }] : []),
    ...(can('forum') ? [{ to: '/admin/forum', icon: 'shield', label: 'Modération forum' }, { to: '/admin/signalements', icon: 'flag', label: 'Messages signalés' }] : []),
    ...(isSuper ? [{ group: 'Sécurité' }, { to: '/admin/equipe', icon: 'key', label: 'Équipe admin' }, { to: '/admin/journal', icon: 'activity', label: "Journal d'activité" }, { to: '/admin/sms', icon: 'phone', label: 'SMS & WhatsApp' }] : []),
    { group: 'Portail' }, { to: '/accueil', icon: 'back', label: 'Portail membre' },
  ];
  return <Shell items={items} admin />;
}
