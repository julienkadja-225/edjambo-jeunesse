import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getTokens, post, setLogoutHandler, setPasswordChangeHandler, setTokens } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getTokens());
  const [unread, setUnread] = useState(0);
  const [msgUnread, setMsgUnread] = useState(0);

  const logout = useCallback(async () => {
    const t = getTokens();
    setTokens(null);
    setUser(null);
    if (t?.refreshToken) post('/auth/logout', { refreshToken: t.refreshToken }).catch(() => {});
  }, []);

  useEffect(() => {
    setLogoutHandler(() => setUser(null));
    setPasswordChangeHandler(() => setUser((u) => (u && !u.must_change_password ? { ...u, must_change_password: true } : u)));
    if (!getTokens()) return;
    api('/auth/me').then(setUser).catch(() => setTokens(null)).finally(() => setLoading(false));
  }, []);

  // Compteur de notifications (rafraîchi toutes les 60 s)
  useEffect(() => {
    if (!user) { setUnread(0); setMsgUnread(0); return; }
    const load = () => {
      api('/notifications/unread-count').then((d) => setUnread(d.count)).catch(() => {});
      api('/messages/unread-count').then((d) => setMsgUnread(d.total)).catch(() => {});
    };
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [user]);

  const login = useCallback(async (identifier, password) => {
    const d = await post('/auth/login', { identifier, password });
    setTokens({ accessToken: d.accessToken, refreshToken: d.refreshToken });
    setUser(d.user);
    return d.user;
  }, []);

  /** Applique une session renvoyée par l'API (connexion, changement de mot de passe). */
  const applySession = useCallback((d) => {
    setTokens({ accessToken: d.accessToken, refreshToken: d.refreshToken });
    setUser(d.user);
  }, []);

  const value = useMemo(() => {
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
    return {
      user, loading, unread, setUnread, msgUnread, setMsgUnread, login, logout, applySession, isAdmin,
      isSuper: user?.role === 'super_admin',
      can: (perm) => user?.role === 'super_admin' || (user?.role === 'admin' && user.permissions.includes(perm)),
      reload: () => api('/auth/me').then(setUser),
    };
  }, [user, loading, unread, msgUnread, login, logout, applySession]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
