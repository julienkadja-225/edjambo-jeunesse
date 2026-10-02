import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../icons.jsx';
import { Async, Badge, Field, Modal, PageHeader, Stat, fmtDateTime, useConfirm, useLoad, useToast } from '../ui.jsx';

function List() {
  const state = useLoad(() => get('/elections'), []);
  return (
    <div className="stack">
      <h1>Votes & élections</h1>
      <Async state={state} empty={(d) => !d.length}>{(d) => (
        <div className="cards">{d.map((e) => (
          <Link to={`/elections/${e.id}`} key={e.id} className="card" style={{ color: 'inherit' }}>
            <div className="row between"><Badge s={e.status} />{e.has_voted && <Badge s="approved">Vous avez voté</Badge>}</div>
            <h2 style={{ marginTop: '.5rem' }}>{e.title}</h2>
            <p className="muted small">Du {fmtDateTime(e.start_at)}<br />au {fmtDateTime(e.end_at)}</p>
            {e.status === 'open' && !e.has_voted && <span className={e.eligible ? 'btn sm' : 'badge red'}>{e.eligible ? 'Voter maintenant' : e.ineligible_reason}</span>}
          </Link>
        ))}</div>
      )}</Async>
    </div>
  );
}

function VerifyReceipt({ id, onClose }) {
  const [receipt, setReceipt] = useState('');
  const [res, setRes] = useState(null);
  const check = async (e) => { e.preventDefault(); setRes(await post(`/elections/${id}/verify-receipt`, { receipt })); };
  return (
    <Modal title="Vérifier mon bulletin" onClose={onClose}>
      <form className="stack" onSubmit={check}>
        <Field label="Code de reçu" hint="Remis après votre vote. Il ne permet pas de remonter jusqu'à vous."><input type="text" required value={receipt} onChange={(e) => setReceipt(e.target.value)} /></Field>
        <button className="btn">Vérifier</button>
        {res && (res.found
          ? <div className="alert green">Bulletin retrouvé dans l'urne ({fmtDateTime(res.created_at)}).{res.published && <> Choix enregistré : <b>{res.candidate}</b>.</>}<div className="hash">Empreinte : {res.hash}</div></div>
          : <div className="alert red">Aucun bulletin ne correspond à ce reçu.</div>)}
      </form>
    </Modal>
  );
}

function Results({ e }) {
  const total = e.candidates.reduce((s, c) => s + (c.votes || 0), 0);
  const max = Math.max(...e.candidates.map((c) => c.votes || 0));
  return (
    <div className="stack">{[...e.candidates].sort((a, b) => b.votes - a.votes).map((c) => (
      <div key={c.id}>
        <div className="row between"><b>{c.votes === max && total > 0 && e.status === 'published' ? '' : ''}{c.name}</b><span>{c.votes} voix · {total ? Math.round((c.votes / total) * 100) : 0} %</span></div>
        <div className="bar"><i style={{ width: `${total ? (c.votes / total) * 100 : 0}%` }} /></div>
      </div>
    ))}</div>
  );
}

function Audit({ id, onClose }) {
  const state = useLoad(() => get(`/elections/${id}/audit`), [id]);
  return (
    <Modal title="Audit des votes" onClose={onClose} wide>
      <Async state={state}>{(a) => (
        <div className="stack">
          <div className={`alert ${a.chain_valid && a.consistent ? 'green' : 'red'}`}>
            {a.chain_valid && a.consistent ? 'Chaîne de bulletins intacte' : 'Anomalie détectée'} — {a.total_ballots} bulletins pour {a.total_voters} votants (anonymes).
          </div>
          <div className="table-wrap" style={{ maxHeight: '50vh', overflowY: 'auto' }}><table>
            <thead><tr><th>#</th><th>Reçu (haché)</th><th>Empreinte</th></tr></thead>
            <tbody>{a.ballots.map((b) => <tr key={b.seq}><td>{b.seq}</td><td className="hash">{b.receipt_hash.slice(0, 20)}…</td><td className="hash">{b.hash.slice(0, 20)}…</td></tr>)}</tbody></table></div>
        </div>
      )}</Async>
    </Modal>
  );
}

function Detail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const state = useLoad(() => get(`/elections/${id}`), [id]);
  const [sel, setSel] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [modal, setModal] = useState(null);

  const vote = async () => {
    if (!(await confirm({ title: 'Confirmer votre vote ?', message: 'Votre choix est définitif et anonyme. Un reçu de vérification vous sera remis.', confirmLabel: 'Voter' }))) return;
    try { const r = await post(`/elections/${id}/vote`, { candidate_id: sel }); setReceipt(r.receipt); state.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stack">
      <Link to="/elections">← Toutes les élections</Link>
      <Async state={state}>{(e) => (
        <>
          <div className="card stack">
            <div className="row"><Badge s={e.status} /><span className="muted small">Du {fmtDateTime(e.start_at)} au {fmtDateTime(e.end_at)}</span></div>
            <h1>{e.title}</h1>
            {e.description && <p>{e.description}</p>}
            {e.require_contribution ? <p className="muted small">Éligibilité : membre actif avec cotisation à jour.</p> : null}
            {e.turnout !== undefined && <p className="muted small">Participation : {e.turnout} votant(s)</p>}
          </div>

          {receipt && (
            <div className="alert green stack">
              <b>Vote enregistré !</b>
              <div>Conservez ce reçu pour vérifier plus tard que votre bulletin figure dans l'urne :</div>
              <div className="hash" style={{ fontSize: '1rem', color: 'inherit' }}>{receipt}</div>
            </div>
          )}

          {e.status === 'open' && !receipt && (e.has_voted
            ? <div className="alert green">Vous avez déjà voté pour cette élection.</div>
            : !e.eligible ? <div className="alert red">Vous ne pouvez pas voter : {e.ineligible_reason}. {e.ineligible_reason?.includes('Cotisation') && <Link to="/cotisations">Régulariser ma cotisation</Link>}</div>
            : !e.can_vote ? <div className="alert amber">Le vote n'a pas encore commencé.</div> : null)}

          {e.results_visible && <div className="card"><h2>{e.status === 'published' ? 'Résultats' : 'Résultats provisoires (admin)'}</h2><Results e={e} /></div>}

          {!e.results_visible || e.can_vote ? (
            <div className="card stack">
              <h2>Candidats</h2>
              {e.candidates.map((c) => (
                <label key={c.id} className={`cand ${sel === c.id ? 'sel' : ''}`} style={{ cursor: e.can_vote ? 'pointer' : 'default' }}>
                  {e.can_vote && <input type="radio" name="cand" checked={sel === c.id} onChange={() => setSel(c.id)} />}
                  <div><b>{c.name}</b>{c.program && <div className="muted small">{c.program}</div>}</div>
                </label>
              ))}
              {e.can_vote && <button className="btn" disabled={!sel} onClick={vote}>Valider mon vote</button>}
            </div>
          ) : null}

          <div className="row">
            {(e.has_voted || receipt) && <button className="btn ghost" onClick={() => setModal('verify')}>Vérifier mon bulletin</button>}
            {(e.status === 'published' || can('elections')) && e.status !== 'draft' && <button className="btn ghost" onClick={() => setModal('audit')}>Audit public</button>}
          </div>
          {modal === 'verify' && <VerifyReceipt id={id} onClose={() => setModal(null)} />}
          {modal === 'audit' && <Audit id={id} onClose={() => setModal(null)} />}
        </>
      )}</Async>
    </div>
  );
}

export { Results, Audit };
export default function Elections({ page }) { return page === 'list' ? <List /> : <Detail />; }
