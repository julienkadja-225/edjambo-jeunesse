import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, patch, post, del } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../icons.jsx';
import { Async, Avatar, Badge, Debounced, Field, Modal, Pager, fmtDateTime, fullName, useConfirm, useLoad, useQueryState, useToast } from '../ui.jsx';

export function VoteBox({ t, onChange }) {
  const toast = useToast();
  const vote = async (value) => { try { await post(`/forum/threads/${t.id}/vote`, { value }); onChange(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="vote-box">
      <button className={t.my_vote === 1 ? 'on' : ''} onClick={() => vote(1)} aria-label="Pour">▲</button>
      <b>{t.score}</b>
      <button className={`down ${t.my_vote === -1 ? 'on' : ''}`} onClick={() => vote(-1)} aria-label="Contre">▼</button>
    </div>
  );
}

function NewThread({ type, categories, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', body: '', category_id: categories?.[0]?.id || '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { const r = await post('/forum/threads', { ...f, type }); toast(type === 'proposal' ? 'Proposition soumise ' : 'Discussion créée'); onDone(r.id); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal title={type === 'proposal' ? 'Nouvelle proposition' : 'Nouvelle discussion'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {err && <div className="alert red">{err}</div>}
        {type === 'discussion' && <Field label="Catégorie"><select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Titre"><input type="text" maxLength={150} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={type === 'proposal' ? 'Décrivez votre idée' : 'Message'}><textarea required maxLength={5000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <button className="btn">Publier</button>
      </form>
    </Modal>
  );
}

function List({ type, admin }) {
  const proposals = type === 'proposal';
  const { can } = useAuth();
  const [q, set, setQ] = useQueryState({ q: '', category: '', sort: proposals ? 'top' : '', hidden: admin ? '1' : '', page: 1 });
  const [creating, setCreating] = useState(false);
  const cats = useLoad(() => get('/forum/categories'), []);
  const state = useLoad(() => get('/forum/threads', { ...q, type, limit: 15 }), [q, type]);
  const base = proposals ? '/propositions' : '/forum';
  const toast = useToast();
  const confirm = useConfirm();
  const mod = async (t, patchBody) => { await patch(`/forum/threads/${t.id}`, patchBody); toast('Mis à jour'); state.reload(); };
  const remove = async (t) => { if (await confirm({ title: 'Supprimer définitivement ?', message: t.title, danger: true, confirmLabel: 'Supprimer' })) { await del(`/forum/threads/${t.id}`); state.reload(); } };

  return (
    <div className="stack">
      <div className="row between"><h1>{admin ? 'Modération' : proposals ? 'Propositions' : 'Forum'}</h1>
        {!admin && <button className="btn" onClick={() => setCreating(true)}>+ {proposals ? 'Proposer une idée' : 'Nouvelle discussion'}</button>}</div>
      {!proposals && <div className="chips">
        <button className={`chip ${!q.category ? 'on' : ''}`} onClick={() => set({ category: '' })}>Toutes</button>
        {(cats.data || []).map((c) => <button key={c.id} className={`chip ${String(q.category) === String(c.id) ? 'on' : ''}`} onClick={() => set({ category: c.id })}>{c.name} ({c.threads})</button>)}
      </div>}
      <div className="filters">
        <div className="wide"><Debounced type="search" placeholder="Rechercher…" value={q.q} onChange={(v) => set({ q: v })} /></div>
        {proposals && <select value={q.sort} onChange={(e) => set({ sort: e.target.value })}><option value="top">Les plus soutenues</option><option value="">Les plus récentes</option></select>}
      </div>
      <Async state={state} empty={(d) => !d.items.length}>{(d) => (
        <div className="card">{d.items.map((t) => (
          <div key={t.id} className="thread" style={t.hidden ? { opacity: .55 } : undefined}>
            {proposals ? <VoteBox t={t} onChange={state.reload} /> : <Avatar u={{ id: t.author_id, first_name: t.first_name, last_name: t.last_name, photo: t.photo }} />}
            <div className="grow">
              <h3>{t.pinned ? <Icon name="pin" size={15} className="inl" /> : null}{t.closed ? <Icon name="lock" size={15} className="inl" /> : null}<Link to={`${base}/${t.id}`}>{t.title}</Link>{t.hidden ? ' (masqué)' : ''}</h3>
              <div className="muted small">{fullName(t, '')} · {fmtDateTime(t.created_at)} {t.category && <Badge s="announcement">{t.category}</Badge>}</div>
              <div className="small muted">{t.body}</div>
              <div className="small muted meta"><span><Icon name="chat" size={14} /> {t.replies}</span><span><Icon name="thumb" size={14} /> {t.likes}</span></div>
              {can('forum') && (
                <div className="row" style={{ marginTop: '.4rem' }}>
                  <button className="btn ghost sm" onClick={() => mod(t, { pinned: !t.pinned })}>{t.pinned ? 'Désépingler' : 'Épingler'}</button>
                  <button className="btn ghost sm" onClick={() => mod(t, { closed: !t.closed })}>{t.closed ? 'Rouvrir' : 'Fermer'}</button>
                  <button className="btn ghost sm" onClick={() => mod(t, { hidden: !t.hidden })}>{t.hidden ? 'Réafficher' : 'Masquer'}</button>
                  <button className="btn red sm" onClick={() => remove(t)}>Supprimer</button>
                </div>
              )}
            </div>
          </div>
        ))}<Pager data={d} onPage={(page) => setQ({ ...q, page })} /></div>
      )}</Async>
      {creating && <NewThread type={type} categories={cats.data} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); location.assign(`${base}/${id}`); }} />}
    </div>
  );
}

function Thread() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [body, setBody] = useState('');
  const state = useLoad(() => get(`/forum/threads/${id}`, { page, limit: 20 }), [id, page]);
  const send = async (e) => {
    e.preventDefault();
    try { await post(`/forum/threads/${id}/posts`, { body }); setBody(''); const t = state.data.posts; setPage(Math.max(t.pages, Math.ceil((t.total + 1) / t.limit))); state.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const like = async (target_type, target_id) => { await post('/forum/react', { target_type, target_id }); state.reload(); };
  const hide = async (p) => { await patch(`/forum/posts/${p.id}`, { hidden: !p.hidden }); state.reload(); };
  return (
    <div className="stack">
      <Async state={state}>{({ thread: t, posts }) => (
        <>
          <Link to={t.type === 'proposal' ? '/propositions' : '/forum'}>← Retour</Link>
          <article className="card">
            <div className="row">{t.type === 'proposal' && <VoteBox t={t} onChange={state.reload} />}
              <div className="grow"><h1>{t.pinned ? <Icon name="pin" size={20} className="inl" /> : null}{t.closed ? <Icon name="lock" size={20} className="inl" /> : null}{t.title}</h1>
                <div className="row small muted"><Avatar u={{ id: t.author_id, first_name: t.first_name, last_name: t.last_name, photo: t.photo }} size={28} />{fullName(t)} · {fmtDateTime(t.created_at)} {t.category && <Badge s="announcement">{t.category}</Badge>}{t.type === 'proposal' && <span>{t.up} · {t.down}</span>}</div></div></div>
            <p className="pre">{t.body}</p>
            <button className={`btn sm ${t.liked ? '' : 'ghost'}`} onClick={() => like('thread', t.id)}><Icon name="thumb" size={15} /> {t.likes}</button>
            {t.closed && <div className="alert amber" style={{ marginTop: '.75rem' }}>Cette discussion est fermée.</div>}
          </article>
          <h2>{posts.total} réponse{posts.total > 1 ? 's' : ''}</h2>
          <div className="card">
            {posts.items.length === 0 && <p className="muted">Soyez le premier à répondre.</p>}
            {posts.items.map((p) => (
              <div key={p.id} className={`post ${p.hidden ? 'hidden' : ''}`}>
                <Avatar u={{ id: p.author_id, first_name: p.first_name, last_name: p.last_name, photo: p.photo }} />
                <div className="grow"><b>{fullName(p)}</b> <span className="muted small">{fmtDateTime(p.created_at)}</span>{p.hidden ? <Badge s="rejected">Masqué</Badge> : null}
                  <p className="pre" style={{ margin: '.25rem 0' }}>{p.body}</p>
                  <div className="row"><button className={`btn sm ${p.liked ? '' : 'ghost'}`} onClick={() => like('post', p.id)}><Icon name="thumb" size={15} /> {p.likes}</button>
                    {can('forum') && <button className="btn ghost sm" onClick={() => hide(p)}>{p.hidden ? 'Réafficher' : 'Masquer'}</button>}</div></div>
              </div>
            ))}
            <Pager data={posts} onPage={setPage} />
          </div>
          {!t.closed && (
            <form className="card stack" onSubmit={send}>
              <Field label="Votre réponse"><textarea required maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
              <button className="btn">Répondre</button>
            </form>
          )}
        </>
      )}</Async>
    </div>
  );
}

export function ForumModeration() { return <List type="discussion" admin />; }

export default function Forum({ page }) {
  if (page === 'forum') return <List type="discussion" />;
  if (page === 'proposals') return <List type="proposal" />;
  return <Thread />;
}
