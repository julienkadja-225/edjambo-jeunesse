import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { del, get, patch, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../icons.jsx';
import { Async, Avatar, Badge, Debounced, Empty, Field, Modal, Spinner, useConfirm, useLoad, useToast } from '../ui.jsx';

/* ---------- Utilitaires ---------- */
const fullName = (u) => `${u?.first_name || ''} ${u?.last_name || ''}`.trim();
const hhmm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function shortTime(iso) {
  const d = new Date(iso);
  const days = (Date.now() - d) / 864e5;
  if (sameDay(iso, new Date())) return hhmm(iso);
  if (days < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}
const dayLabel = (iso) => {
  if (sameDay(iso, new Date())) return "Aujourd'hui";
  if (sameDay(iso, new Date(Date.now() - 864e5))) return 'Hier';
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

function useInterval(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    const onVisible = () => { if (!document.hidden) ref.current(); }; // rattrapage immédiat au retour sur l'onglet
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [ms]);
}

const GroupAvatar = ({ size = 44 }) => <span className="avatar group-avatar" style={{ width: size, height: size }}><Icon name="users" size={size * 0.5} /></span>;

/* ---------- Sélecteur de personnes ---------- */
function PeoplePicker({ multiple, selected, onChange, exclude = [] }) {
  const [q, setQ] = useState('');
  const results = useLoad(() => (q.trim().length >= 2 ? get('/messages/people', { q }) : Promise.resolve([])), [q]);
  const isSel = (u) => selected.some((s) => s.id === u.id);
  const toggle = (u) => {
    if (!multiple) return onChange([u]);
    onChange(isSel(u) ? selected.filter((s) => s.id !== u.id) : [...selected, u]);
  };
  return (
    <div className="stack">
      {selected.length > 0 && (
        <div className="chips" style={{ marginBottom: 0 }}>
          {selected.map((u) => (
            <span key={u.id} className="chip on">{fullName(u)} <button type="button" className="link chip-x" aria-label={`Retirer ${fullName(u)}`} onClick={() => toggle(u)}><Icon name="x" size={12} /></button></span>
          ))}
        </div>
      )}
      <Debounced type="search" placeholder="Rechercher un membre par nom…" value={q} onChange={setQ} autoFocus />
      <div className="people-list">
        {q.trim().length < 2 ? <p className="muted small" style={{ margin: 0 }}>Saisissez au moins 2 lettres.</p>
          : results.loading && !results.data ? <Spinner />
          : (results.data || []).filter((u) => !exclude.includes(u.id)).map((u) => (
            <button type="button" key={u.id} className={`person ${isSel(u) ? 'sel' : ''}`} onClick={() => toggle(u)}>
              <Avatar u={u} size={36} />
              <span className="grow"><b>{fullName(u)}</b><small>{u.role === 'member' ? u.neighborhood : 'Bureau de la jeunesse'}</small></span>
              {isSel(u) && <Icon name="check" size={18} />}
            </button>
          ))}
        {q.trim().length >= 2 && !results.loading && !(results.data || []).filter((u) => !exclude.includes(u.id)).length && <p className="muted small" style={{ margin: 0 }}>Aucun membre trouvé.</p>}
      </div>
    </div>
  );
}

/* ---------- Nouvelle conversation ---------- */
function NewConversation({ onClose, onCreated }) {
  const toast = useToast();
  const [mode, setMode] = useState('direct');
  const [people, setPeople] = useState([]);
  const [text, setText] = useState('');
  const [group, setGroup] = useState({ title: '', description: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'direct') {
        const r = await post('/messages/direct', { user_id: people[0].id, body: text });
        toast('Demande envoyée : la personne doit l\'accepter pour échanger');
        onCreated(r.id);
      } else {
        const r = await post('/messages/groups', { ...group, member_ids: people.map((p) => p.id) });
        toast(r.invited ? `Groupe créé · ${r.invited} invitation(s) envoyée(s)` : 'Groupe créé');
        onCreated(r.id);
      }
    } catch (er) { toast(er.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Nouvelle conversation" onClose={onClose}>
      <div className="chips">
        <button type="button" className={`chip ${mode === 'direct' ? 'on' : ''}`} onClick={() => { setMode('direct'); setPeople(people.slice(0, 1)); }}>Message privé</button>
        <button type="button" className={`chip ${mode === 'group' ? 'on' : ''}`} onClick={() => setMode('group')}>Groupe</button>
      </div>
      <form className="stack" onSubmit={submit}>
        {mode === 'group' && (
          <>
            <Field label="Nom du groupe"><input type="text" required minLength={3} maxLength={80} value={group.title} onChange={(e) => setGroup({ ...group, title: e.target.value })} /></Field>
            <Field label="Description (facultative)"><input type="text" maxLength={300} value={group.description} onChange={(e) => setGroup({ ...group, description: e.target.value })} /></Field>
          </>
        )}
        <div>
          <b className="small">{mode === 'direct' ? 'Destinataire' : 'Inviter des membres'}</b>
          <PeoplePicker multiple={mode === 'group'} selected={people} onChange={setPeople} />
        </div>
        {mode === 'direct' && <Field label="Votre message" hint="La personne devra accepter votre demande avant de pouvoir vous répondre."><textarea required maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
        {mode === 'group' && <div className="alert violet"><Icon name="info" size={18} /> Chaque personne invitée doit accepter l'invitation pour rejoindre le groupe.</div>}
        <button className="btn" disabled={busy || (mode === 'direct' && !people.length)}>{busy ? 'Envoi…' : mode === 'direct' ? 'Envoyer la demande' : 'Créer le groupe'}</button>
      </form>
    </Modal>
  );
}

/* ---------- Liste des conversations ---------- */
function ConversationList({ activeId, tab, onTab, refreshKey, onOpen }) {
  const { user } = useAuth();
  const toast = useToast();
  const state = useLoad(() => get('/messages', { tab: tab === 'invitations' ? 'invitations' : '', limit: 100 }), [tab, refreshKey]);
  const counts = useLoad(() => get('/messages/unread-count'), [refreshKey]);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  useInterval(() => { state.reload(); counts.reload(); }, 10000);
  const nav = useNavigate();

  const respond = async (c, accept) => {
    try {
      await post(`/messages/${c.id}/${accept ? 'accept' : 'decline'}`);
      toast(accept ? 'Invitation acceptée' : 'Invitation refusée');
      if (accept) { onTab('discussions'); nav(`/messages/${c.id}`); } else { state.reload(); counts.reload(); }
    } catch (e) { toast(e.message, 'err'); }
  };
  const items = (state.data?.items || []).filter((c) => !filter || (c.title || '').toLowerCase().includes(filter.toLowerCase()));
  return (
    <aside className="chat-list" aria-label="Conversations">
      <div className="chat-list-head">
        <h1>Messagerie</h1>
        <button className="btn sm" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Nouveau</button>
      </div>
      <div className="chat-tabs" role="tablist">
        <button role="tab" aria-selected={tab !== 'invitations'} className={tab !== 'invitations' ? 'on' : ''} onClick={() => onTab('discussions')}>Discussions{counts.data?.messages > 0 && <span className="count">{counts.data.messages}</span>}</button>
        <button role="tab" aria-selected={tab === 'invitations'} className={tab === 'invitations' ? 'on' : ''} onClick={() => onTab('invitations')}>Invitations{counts.data?.invitations > 0 && <span className="count">{counts.data.invitations}</span>}</button>
      </div>
      <div style={{ padding: '0 .75rem .5rem' }}><input type="search" placeholder="Filtrer…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      <div className="chat-items">
        <Async state={state} empty={(d) => !d.items.length}>{() => (
          items.length === 0 ? <Empty>{tab === 'invitations' ? 'Aucune invitation en attente.' : 'Aucune conversation.'}</Empty> : items.map((c) => (
            tab === 'invitations' ? (
              <div key={c.id} className="invite-card">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  {c.type === 'group' ? <GroupAvatar /> : <Avatar u={c.other || {}} size={44} />}
                  <div className="grow">
                    <b>{c.title}</b>
                    <div className="small muted">{c.type === 'group' ? `Invitation de ${fullName(c.inviter)} · ${c.member_count} membre(s)` : 'Demande de discussion'}</div>
                  </div>
                </div>
                {c.type === 'group' && c.description && <p className="small" style={{ margin: '.4rem 0 0' }}>{c.description}</p>}
                {c.preview && <p className="invite-preview">« {c.preview} »</p>}
                <div className="row" style={{ marginTop: '.6rem' }}>
                  <button className="btn green sm" onClick={() => respond(c, true)}><Icon name="check" size={15} /> Accepter</button>
                  <button className="btn ghost sm" onClick={() => respond(c, false)}>Refuser</button>
                </div>
              </div>
            ) : (
              <Link key={c.id} to={`/messages/${c.id}`} className={`conv ${String(activeId) === String(c.id) ? 'active' : ''}`} onClick={onOpen}>
                {c.type === 'group' ? <GroupAvatar /> : <Avatar u={c.other || {}} size={44} />}
                <div className="grow conv-main">
                  <div className="row between" style={{ flexWrap: 'nowrap' }}><b className="ellipsis">{c.title}</b><span className="small muted nowrap">{c.last ? shortTime(c.last.created_at) : ''}</span></div>
                  <div className="row between" style={{ flexWrap: 'nowrap' }}>
                    <span className="small muted ellipsis">{c.last ? (c.last.kind === 'system' ? c.last.body : `${c.last.mine ? 'Vous : ' : c.type === 'group' ? `${c.last.first_name} : ` : ''}${c.last.body}`) : 'Aucun message'}</span>
                    {c.unread > 0 && <span className="count">{c.unread}</span>}
                  </div>
                </div>
              </Link>
            )
          ))
        )}</Async>
      </div>
      {creating && <NewConversation onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onTab('discussions'); nav(`/messages/${id}`); state.reload(); }} />}
    </aside>
  );
}

/* ---------- Informations & gestion du groupe ---------- */
function GroupInfo({ info, onClose, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const { user } = useAuth();
  const [edit, setEdit] = useState({ title: info.title, description: info.description || '' });
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState([]);
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); onChanged(); } catch (e) { toast(e.message, 'err'); } };
  const invite = () => run(async () => {
    const r = await post(`/messages/${info.id}/invite`, { user_ids: picked.map((p) => p.id) });
    setAdding(false); setPicked([]);
    toast(r.invited ? `${r.invited} invitation(s) envoyée(s). Chaque personne doit accepter.` : 'Aucune nouvelle invitation (déjà invité(s) ou refus récent).');
  });
  const leave = async () => {
    if (!(await confirm({ title: 'Quitter le groupe ?', message: info.is_owner ? 'La propriété du groupe sera transmise à un autre membre.' : 'Vous ne recevrez plus les messages.', danger: true, confirmLabel: 'Quitter' }))) return;
    await run(() => post(`/messages/${info.id}/leave`));
    nav('/messages');
  };
  const dissolve = async () => {
    if (!(await confirm({ title: 'Supprimer le groupe ?', message: 'Tous les messages seront définitivement effacés pour tout le monde.', danger: true, confirmLabel: 'Supprimer' }))) return;
    await run(() => del(`/messages/${info.id}`));
    nav('/messages');
  };
  const roleBadge = (m) => m.status === 'invited' ? <Badge s="pending">Invitation envoyée</Badge> : m.role === 'owner' ? <Badge s="super_admin">Créateur</Badge> : m.role === 'admin' ? <Badge s="admin">Admin</Badge> : null;
  return (
    <Modal title="Informations du groupe" onClose={onClose} wide>
      <div className="stack">
        {info.can_manage ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => patch(`/messages/${info.id}`, edit), 'Groupe mis à jour'); }}>
            <div className="grid2">
              <Field label="Nom"><input type="text" required minLength={3} maxLength={80} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
              <Field label="Description"><input type="text" maxLength={300} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            </div>
            <div><button className="btn sm">Enregistrer</button></div>
          </form>
        ) : <div><h3 style={{ margin: 0 }}>{info.title}</h3>{info.description && <p className="muted" style={{ margin: '.25rem 0 0' }}>{info.description}</p>}</div>}

        <div className="row between"><h3 style={{ margin: 0 }}>{info.member_count} membre(s)</h3>
          {info.can_manage && <button className="btn ghost sm" onClick={() => setAdding((v) => !v)}><Icon name="plus" size={15} /> Inviter</button>}</div>
        {adding && (
          <div className="card flat stack">
            <PeoplePicker multiple selected={picked} onChange={setPicked} exclude={info.members.map((m) => m.id)} />
            <p className="muted small" style={{ margin: 0 }}>Les personnes invitées devront accepter avant de rejoindre le groupe.</p>
            <div><button className="btn sm" disabled={!picked.length} onClick={invite}>Envoyer {picked.length || ''} invitation(s)</button></div>
          </div>
        )}
        <div className="member-rows">
          {info.members.map((m) => (
            <div key={m.id} className="member-row">
              <Avatar u={m} size={36} />
              <div className="grow"><b>{fullName(m)}{m.id === user.id ? ' (vous)' : ''}</b></div>
              {roleBadge(m)}
              {info.can_manage && m.id !== user.id && m.role !== 'owner' && (info.is_owner || m.role !== 'admin') && (
                <span className="row" style={{ gap: '.25rem' }}>
                  {info.is_owner && m.status === 'active' && <button className="btn ghost sm" onClick={() => run(() => patch(`/messages/${info.id}/members/${m.id}`, { role: m.role === 'admin' ? 'member' : 'admin' }), 'Rôle modifié')}>{m.role === 'admin' ? 'Retirer admin' : 'Nommer admin'}</button>}
                  <button className="btn red sm" onClick={async () => { if (await confirm({ title: m.status === 'invited' ? "Annuler l'invitation ?" : `Retirer ${fullName(m)} ?`, danger: true, confirmLabel: m.status === 'invited' ? 'Annuler' : 'Retirer' })) run(() => del(`/messages/${info.id}/members/${m.id}`), 'Membre retiré'); }}>{m.status === 'invited' ? 'Annuler' : 'Retirer'}</button>
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn ghost" onClick={leave}><Icon name="logout" size={16} /> Quitter le groupe</button>
          {info.is_owner && <button className="btn red" onClick={dissolve}><Icon name="trash" size={16} /> Supprimer le groupe</button>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Bulle de message ---------- */
function Bubble({ m, mine, group, showName, canModerate, onAction, editing, setEditing, menuOpen, setMenuOpen }) {
  if (m.kind === 'system') return <div className="msg-system">{m.body}</div>;
  const canEdit = mine && !m.deleted && Date.now() - new Date(m.created_at) < 24 * 36e5;
  return (
    <div className={`msg ${mine ? 'mine' : ''}`}>
      {!mine && group ? <Avatar u={{ id: m.sender_id, first_name: m.first_name, last_name: m.last_name, photo: m.photo }} size={30} /> : null}
      <div className="msg-col">
        {showName && !mine && <span className="msg-name">{fullName(m)}</span>}
        <div className={`bubble ${m.deleted ? 'deleted' : ''}`}>
          {m.deleted ? <i>Message supprimé</i> : editing?.id === m.id ? (
            <form onSubmit={(e) => { e.preventDefault(); onAction('save', m, editing.body); }}>
              <textarea className="edit-area" autoFocus value={editing.body} maxLength={2000} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              <div className="row" style={{ marginTop: '.3rem' }}><button className="btn sm green">Enregistrer</button><button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>Annuler</button></div>
            </form>
          ) : <span className="pre">{m.body}</span>}
          <span className="msg-meta">{m.edited && !m.deleted ? 'modifié · ' : ''}{hhmm(m.created_at)}</span>
        </div>
        {!m.deleted && !editing && (
          <div className="msg-menu-wrap">
            <button className="msg-more" aria-label="Actions du message" onClick={() => setMenuOpen(menuOpen ? null : m.id)}><Icon name="more" size={16} /></button>
            {menuOpen && (
              <div className="msg-menu" onMouseLeave={() => setMenuOpen(null)}>
                {canEdit && <button onClick={() => { setEditing({ id: m.id, body: m.body }); setMenuOpen(null); }}><Icon name="edit" size={14} /> Modifier</button>}
                {(mine || canModerate) && <button onClick={() => { onAction('delete', m); setMenuOpen(null); }}><Icon name="trash" size={14} /> Supprimer</button>}
                {!mine && <button onClick={() => { onAction('report', m); setMenuOpen(null); }}><Icon name="flag" size={14} /> Signaler</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Fil de discussion ---------- */
function Thread({ id, onActivity, onBack }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const info = useLoad(() => get(`/messages/${id}`), [id]);
  const [msgs, setMsgs] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [reporting, setReporting] = useState(null);
  const [menu, setMenu] = useState(false);
  const listRef = useRef(null);
  const stick = useRef(true);
  const tick = useRef(0);
  const status = info.data?.me?.status;

  const loadLatest = useCallback(async () => {
    const d = await get(`/messages/${id}/messages`, { limit: 40 });
    setMsgs(d.items);
    setHasMore(d.has_more);
  }, [id]);

  useEffect(() => { setMsgs(null); stick.current = true; if (status) loadLatest().catch(() => setMsgs([])); }, [id, status, loadLatest]);

  const poll = useCallback(async () => {
    if (!msgs || status !== 'active') return;
    tick.current++;
    if (tick.current % 5 === 0) { // rafraîchissement complet : modifications / suppressions faites par les autres
      const d = await get(`/messages/${id}/messages`, { limit: 40 });
      setMsgs((prev) => {
        const byId = new Map(d.items.map((x) => [x.id, x]));
        const older = (prev || []).filter((x) => !byId.has(x.id) && x.id < (d.items[0]?.id ?? Infinity));
        return [...older, ...d.items];
      });
      return;
    }
    const last = msgs.length ? msgs[msgs.length - 1].id : 0;
    const d = await get(`/messages/${id}/messages`, { after: last });
    if (d.items.length) {
      setMsgs((prev) => [...prev, ...d.items]);
      onActivity();
      if (d.items.some((x) => x.kind === 'system')) info.reload();
    }
  }, [id, msgs, status, onActivity]); // eslint-disable-line
  useInterval(() => poll().catch(() => {}), 4000);

  useLayoutEffect(() => { if (stick.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs]);
  const onScroll = () => { const el = listRef.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; };

  const older = async () => {
    const first = msgs[0]?.id;
    const el = listRef.current;
    const prevH = el.scrollHeight;
    const d = await get(`/messages/${id}/messages`, { before: first, limit: 40 });
    stick.current = false;
    setMsgs((p) => [...d.items, ...p]);
    setHasMore(d.has_more);
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevH; });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await post(`/messages/${id}/messages`, { body });
      setText('');
      stick.current = true;
      await poll();
      onActivity();
      info.reload();
    } catch (e) { toast(e.message, 'err'); } finally { setSending(false); }
  };

  const respond = async (accept) => {
    try { await post(`/messages/${id}/${accept ? 'accept' : 'decline'}`); onActivity(); if (accept) info.reload(); else nav('/messages'); } catch (e) { toast(e.message, 'err'); }
  };

  const onAction = async (act, m, body) => {
    try {
      if (act === 'save') { await patch(`/messages/${id}/messages/${m.id}`, { body }); setEditing(null); setMsgs((p) => p.map((x) => (x.id === m.id ? { ...x, body, edited: true } : x))); }
      if (act === 'delete') {
        if (!(await confirm({ title: 'Supprimer ce message ?', message: 'Il sera remplacé par « Message supprimé » pour tous.', danger: true, confirmLabel: 'Supprimer' }))) return;
        await del(`/messages/${id}/messages/${m.id}`);
        setMsgs((p) => p.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '' } : x)));
      }
      if (act === 'report') setReporting(m);
    } catch (e) { toast(e.message, 'err'); }
  };

  const leaveDirect = async () => {
    if (!(await confirm({ title: 'Quitter cette discussion ?', message: 'Elle disparaîtra de votre liste. La personne pourra de nouveau vous envoyer une demande.', confirmLabel: 'Quitter' }))) return;
    await post(`/messages/${id}/leave`); onActivity(); nav('/messages');
  };
  const block = async () => {
    const o = info.data.other;
    if (!(await confirm({ title: `Bloquer ${fullName(o)} ?`, message: 'Cette personne ne pourra plus vous écrire ni vous inviter, et la discussion sera retirée de votre liste.', danger: true, confirmLabel: 'Bloquer' }))) return;
    await post('/messages/blocks', { user_id: o.id }); toast('Membre bloqué'); onActivity(); nav('/messages');
  };

  if (info.loading && !info.data) return <section className="chat-thread"><Spinner /></section>;
  if (info.error) return <section className="chat-thread"><div className="chat-empty"><p>Conversation introuvable.</p><Link className="btn" to="/messages">Retour</Link></div></section>;
  const c = info.data;
  const group = c.type === 'group';
  const header = (
    <header className="thread-head">
      <button className="icon-btn back-btn" onClick={onBack} aria-label="Retour aux conversations"><Icon name="back" /></button>
      {group ? <GroupAvatar size={40} /> : <Avatar u={c.other || {}} size={40} />}
      <div className="grow" style={{ minWidth: 0 }}>
        <b className="ellipsis" style={{ display: 'block' }}>{c.title}</b>
        <small className="muted">{group ? `${c.member_count} membre(s)` : c.other?.role && c.other.role !== 'member' ? 'Bureau de la jeunesse' : c.other?.neighborhood || ''}</small>
      </div>
      {status === 'active' && (
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" aria-label="Options" onClick={() => (group ? setShowInfo(true) : setMenu((v) => !v))}><Icon name={group ? 'info' : 'more'} /></button>
          {menu && !group && (
            <div className="msg-menu head-menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { setMenu(false); leaveDirect(); }}><Icon name="logout" size={14} /> Quitter la discussion</button>
              <button onClick={() => { setMenu(false); block(); }}><Icon name="ban" size={14} /> Bloquer</button>
            </div>
          )}
        </div>
      )}
    </header>
  );

  // Invitation pas encore acceptée
  if (status === 'invited') {
    return (
      <section className="chat-thread">
        {header}
        <div className="invite-view">
          <div className="card stack" style={{ maxWidth: 480, margin: '1.5rem auto', textAlign: 'center' }}>
            {group ? <GroupAvatar size={64} /> : <Avatar u={c.other || {}} size={64} />}
            <h2 style={{ margin: 0 }}>{group ? c.title : fullName(c.other)}</h2>
            <p className="muted" style={{ margin: 0 }}>{group ? `${fullName(c.inviter)} vous invite à rejoindre ce groupe.` : `${fullName(c.inviter)} souhaite discuter avec vous.`}</p>
            {group && c.description && <p style={{ margin: 0 }}>{c.description}</p>}
            {msgs?.length > 0 && <div className="invite-preview">« {msgs[0].body} »</div>}
            <p className="muted small" style={{ margin: 0 }}>{group ? "Vous ne verrez les messages qu'après avoir accepté, et seulement ceux envoyés à partir de ce moment." : "Vous pourrez répondre dès que vous aurez accepté."}</p>
            <div className="row center"><button className="btn green" onClick={() => respond(true)}><Icon name="check" size={16} /> Accepter</button><button className="btn ghost" onClick={() => respond(false)}>Refuser</button></div>
          </div>
        </div>
      </section>
    );
  }

  const blocked = !group && c.blocked;
  const declined = !group && c.other?.status === 'declined';
  const pending = !group && c.pending_reply;
  const disabled = blocked || declined || pending;
  const manager = group && c.can_manage;
  return (
    <section className="chat-thread">
      {header}
      {pending && <div className="alert amber thread-banner"><Icon name="clock" size={18} /> Votre demande est en attente : {fullName(c.other)} doit l'accepter avant que vous puissiez échanger.</div>}
      {declined && <div className="alert red thread-banner"><Icon name="ban" size={18} /> Cette personne a décliné la discussion.</div>}
      <div className="msg-list" ref={listRef} onScroll={onScroll}>
        {msgs === null ? <Spinner /> : (
          <>
            {hasMore && <div className="center-row"><button className="btn ghost sm" onClick={older}>Messages précédents</button></div>}
            {msgs.length === 0 && <div className="chat-empty"><p className="muted">Aucun message. Écrivez le premier !</p></div>}
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              return (
                <div key={m.id}>
                  {(!prev || !sameDay(prev.created_at, m.created_at)) && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
                  <Bubble m={m} mine={m.sender_id === user.id} group={group} showName={group && (!prev || prev.sender_id !== m.sender_id || prev.kind === 'system')}
                    canModerate={manager} onAction={onAction} editing={editing} setEditing={setEditing}
                    menuOpen={menuOpen === m.id} setMenuOpen={setMenuOpen} />
                </div>
              );
            })}
          </>
        )}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea rows={1} placeholder={disabled ? 'Envoi impossible pour le moment' : 'Écrire un message…'} disabled={disabled} maxLength={2000} value={text}
          onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Votre message" />
        <button className="btn send-btn" disabled={disabled || sending || !text.trim()} aria-label="Envoyer"><Icon name="send" size={18} /></button>
      </form>
      {showInfo && <GroupInfo info={c} onClose={() => setShowInfo(false)} onChanged={() => { info.reload(); onActivity(); }} />}
      {reporting && <ReportModal m={reporting} convId={id} onClose={() => setReporting(null)} />}
    </section>
  );
}

function ReportModal({ m, convId, onClose }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { await post(`/messages/${convId}/messages/${m.id}/report`, { reason }); toast('Signalement transmis à la modération'); onClose(); } catch (er) { toast(er.message, 'err'); }
  };
  return (
    <Modal title="Signaler ce message" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="invite-preview">« {m.body} »</div>
        <Field label="Motif (facultatif)"><textarea maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Insultes, harcèlement, spam…" /></Field>
        <div className="alert amber"><Icon name="info" size={18} /> Seul ce message et les deux précédents seront transmis à l'équipe de modération. Vos échanges restent privés.</div>
        <button className="btn red">Envoyer le signalement</button>
      </form>
    </Modal>
  );
}

/* ---------- Page ---------- */
export default function Messages() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { setMsgUnread } = useAuth();
  const [tab, setTab] = useState(sp.get('tab') === 'invitations' ? 'invitations' : 'discussions');
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => {
    setRefreshKey((k) => k + 1);
    get('/messages/unread-count').then((d) => setMsgUnread(d.total)).catch(() => {});
  }, [setMsgUnread]);
  useEffect(() => { if (sp.get('tab') === 'invitations') setTab('invitations'); }, [sp]);
  useEffect(() => { bump(); }, [id, bump]);
  const changeTab = (t) => { setTab(t); setSp(t === 'invitations' ? { tab: 'invitations' } : {}, { replace: true }); };

  return (
    <div className={`chat ${id ? 'has-thread' : ''}`}>
      <ConversationList activeId={id} tab={tab} onTab={changeTab} refreshKey={refreshKey} onOpen={() => {}} />
      {id ? <Thread key={id} id={id} onActivity={bump} onBack={() => nav('/messages')} /> : (
        <section className="chat-thread chat-placeholder">
          <div className="chat-empty"><Icon name="message" size={44} /><h2>Vos messages</h2><p className="muted">Sélectionnez une conversation ou démarrez-en une nouvelle.<br />Les discussions privées et les groupes exigent l'accord de la personne invitée.</p></div>
        </section>
      )}
    </div>
  );
}
