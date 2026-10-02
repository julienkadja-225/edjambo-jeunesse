import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Spinner } from './ui.jsx';
import { AdminLayout, MemberLayout } from './layouts.jsx';

// Chargement différé par portail : le portail admin n'est téléchargé que par les administrateurs
const Public = lazy(() => import('./pages/Public.jsx'));
const Member = lazy(() => import('./pages/Member.jsx'));
const Forum = lazy(() => import('./pages/Forum.jsx'));
const Elections = lazy(() => import('./pages/Elections.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));

function Guard({ children, admin }) {
  const { user, loading, isAdmin } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/connexion" state={{ from: loc.pathname }} replace />;
  if (user.must_change_password) return <Navigate to="/changer-mot-de-passe" replace />;
  if (admin && !isAdmin) return <Navigate to="/accueil" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  const P = (name, props) => {
    const C = { Public, Member, Forum, Elections, Admin, Messages }[props.mod];
    return <C page={name} />;
  };
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/accueil" replace /> : P('landing', { mod: 'Public' })} />
        <Route path="/connexion" element={P('login', { mod: 'Public' })} />
        <Route path="/inscription" element={P('register', { mod: 'Public' })} />
        <Route path="/a/:id" element={P('shared', { mod: 'Public' })} />
        <Route path="/mot-de-passe-oublie" element={P('forgot', { mod: 'Public' })} />
        <Route path="/reinitialiser/:token" element={P('reset', { mod: 'Public' })} />
        <Route path="/changer-mot-de-passe" element={P('forceChange', { mod: 'Public' })} />

        <Route element={<Guard><MemberLayout /></Guard>}>
          <Route path="/accueil" element={P('dashboard', { mod: 'Member' })} />
          <Route path="/annonces" element={P('announcements', { mod: 'Member' })} />
          <Route path="/annonces/:id" element={P('announcement', { mod: 'Member' })} />
          <Route path="/cotisations" element={P('contributions', { mod: 'Member' })} />
          <Route path="/membres" element={P('directory', { mod: 'Member' })} />
          <Route path="/membres/:id" element={P('memberProfile', { mod: 'Member' })} />
          <Route path="/profil" element={P('profile', { mod: 'Member' })} />
          <Route path="/notifications" element={P('notifications', { mod: 'Member' })} />
          <Route path="/forum" element={P('forum', { mod: 'Forum' })} />
          <Route path="/forum/:id" element={P('thread', { mod: 'Forum' })} />
          <Route path="/propositions" element={P('proposals', { mod: 'Forum' })} />
          <Route path="/propositions/:id" element={P('thread', { mod: 'Forum' })} />
          <Route path="/messages" element={P('inbox', { mod: 'Messages' })} />
          <Route path="/messages/:id" element={P('inbox', { mod: 'Messages' })} />
          <Route path="/elections" element={P('list', { mod: 'Elections' })} />
          <Route path="/elections/:id" element={P('detail', { mod: 'Elections' })} />
        </Route>

        <Route path="/admin" element={<Guard admin><AdminLayout /></Guard>}>
          <Route index element={P('overview', { mod: 'Admin' })} />
          <Route path="membres" element={P('members', { mod: 'Admin' })} />
          <Route path="paiements" element={P('payments', { mod: 'Admin' })} />
          <Route path="paiement-infos" element={P('paymentInfo', { mod: 'Admin' })} />
          <Route path="elections" element={P('elections', { mod: 'Admin' })} />
          <Route path="annonces" element={P('announcements', { mod: 'Admin' })} />
          <Route path="forum" element={P('forum', { mod: 'Admin' })} />
          <Route path="equipe" element={P('team', { mod: 'Admin' })} />
          <Route path="journal" element={P('audit', { mod: 'Admin' })} />
          <Route path="signalements" element={P('reports', { mod: 'Admin' })} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
