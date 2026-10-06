import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../api.js';
import Icon, { Logo } from '../icons.jsx';
import {
  Async, Badge, FileViewer, Modal, Pager, Stat, fmtDate, fmtMoney, fmtMonth, useLoad, useQueryState,
} from '../ui.jsx';

const short = (v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace('.0', '')} M` : v >= 1000 ? `${Math.round(v / 1000)} k` : String(v));
const monthShort = (m) => fmtMonth(m).split(' ')[0].slice(0, 3);

/** Deux barres par mois : recettes (cotisations validées) et dépenses validées. */
export function DualBars({ history }) {
  const max = Math.max(1, ...history.flatMap((h) => [h.income, h.expenses]));
  return (
    <div>
      <div className="dual" role="img" aria-label="Recettes et dépenses des 12 derniers mois">
        {history.map((h) => (
          <div key={h.month} className="dual-col" title={`${fmtMonth(h.month)} — recettes ${fmtMoney(h.income)}, dépenses ${fmtMoney(h.expenses)}`}>
            <div className="dual-bars">
              <i className="in" style={{ height: `${Math.max(2, (h.income / max) * 100)}%` }} />
              <i className="out" style={{ height: `${Math.max(2, (h.expenses / max) * 100)}%` }} />
            </div>
            <span className="chart-lbl">{monthShort(h.month)}</span>
          </div>
        ))}
      </div>
      <div className="legend"><span><i className="in" /> Cotisations validées</span><span><i className="out" /> Dépenses</span><span className="muted small">Maximum : {short(max)} FCFA</span></div>
    </div>
  );
}

export function ProgressRow({ label, spent, planned }) {
  const pct = planned ? Math.round((spent / planned) * 100) : 0;
  return (
    <div className="prog">
      <div className="row between"><b>{label}</b><span className="small muted">{fmtMoney(spent)} / {fmtMoney(planned)} · {pct} %</span></div>
      <div className="bar"><i style={{ width: `${Math.min(100, pct)}%`, background: pct > 100 ? 'var(--red)' : pct > 85 ? 'var(--amber)' : undefined }} /></div>
    </div>
  );
}

function Overview() {
  const sum = useLoad(() => get('/finance/summary'), []);
  const meta = useLoad(() => get('/finance/meta'), []);
  const [q, set, setQ] = useQueryState({ category: '', month: '', page: 1 });
  const list = useLoad(() => get('/finance/expenses', { ...q, limit: 12 }), [q]);
  const [receipt, setReceipt] = useState(null);

  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Transparence financière</h1><p className="muted">Ce que la jeunesse collecte et la façon dont l'argent est utilisé. Aucune donnée personnelle de cotisant n'est affichée.</p></div>
        <Link className="btn ghost" to="/finances/rapport"><Icon name="file" size={16} /> Rapport mensuel</Link>
      </div>
      <Async state={sum}>{(s) => (
        <>
          <div className="stats">
            <Stat icon="wallet" tone="green" label="Solde de la caisse" value={fmtMoney(s.balance)} sub="cotisations validées − dépenses validées" />
            <Stat icon="activity" label={`Cotisations — ${fmtMonth(s.month)}`} value={fmtMoney(s.month_income)} sub={`${s.paying_members} membre(s) à jour`} />
            <Stat icon="file" tone="orange" label={`Dépenses — ${fmtMonth(s.month)}`} value={fmtMoney(s.month_expenses)} />
            <Stat icon="chart" tone="dark" label="Total collecté" value={fmtMoney(s.total_income)} sub={`dépensé : ${fmtMoney(s.total_expenses)}`} />
          </div>
          <div className="card"><h2>Recettes et dépenses sur 12 mois</h2><DualBars history={s.history} /></div>
          <div className="cards">
            <div className="card stack"><h2>Dépenses {s.year} par catégorie</h2>
              {s.by_category.length ? s.by_category.map((c) => <ProgressRow key={c.category} label={c.label} spent={c.total} planned={s.by_category[0].total} />) : <p className="muted">Aucune dépense validée cette année.</p>}
            </div>
            <div className="card stack"><h2>Budget {s.year}</h2>
              {s.budgets.length ? s.budgets.map((b) => <ProgressRow key={b.category} label={b.label} spent={b.spent} planned={b.planned} />) : <p className="muted">Aucun budget défini pour cette année.</p>}
            </div>
          </div>
        </>
      )}</Async>

      <div className="section-title"><h2>Détail des dépenses validées</h2></div>
      <div className="filters">
        <select aria-label="Filtrer par catégorie" value={q.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">Toutes les catégories</option>
          {Object.entries(meta.data?.categories || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="month" value={q.month} onChange={(e) => set({ month: e.target.value })} aria-label="Mois" />
      </div>
      <Async state={list} empty={(d) => !d.items.length}>{(d) => (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Catégorie</th><th>Objet</th><th className="right">Montant</th><th /></tr></thead>
            <tbody>{d.items.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{fmtDate(e.spent_at)}</td><td><Badge s="announcement">{e.category_label}</Badge></td><td>{e.description}</td>
                <td className="right nowrap"><b>{fmtMoney(e.amount)}</b></td>
                <td>{e.can_view_receipt ? <button className="btn ghost sm" onClick={() => setReceipt(e)}><Icon name="file" size={14} /> Justificatif</button> : e.has_receipt ? <span className="muted small">Justificatif conservé</span> : null}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={3}><b>Total affiché</b></td><td className="right"><b>{fmtMoney(d.sum)}</b></td><td /></tr></tfoot>
          </table></div>
          <Pager data={d} onPage={(page) => setQ({ ...q, page })} />
        </>
      )}</Async>
      {receipt && <Modal title={`Justificatif — ${receipt.description}`} onClose={() => setReceipt(null)} wide><FileViewer path={`/finance/expenses/${receipt.id}/receipt`} /></Modal>}
    </div>
  );
}

/** Rapport mensuel : lisible à l'écran et prêt à imprimer / enregistrer en PDF. */
function Report() {
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') || new Date().toISOString().slice(0, 7);
  const state = useLoad(() => get('/finance/report', { month }), [month]);
  return (
    <div className="stack report">
      <div className="row between no-print">
        <Link to="/finances">← Retour aux finances</Link>
        <div className="row">
          <input type="month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && setSp({ month: e.target.value })} aria-label="Mois du rapport" />
          <button className="btn" onClick={() => window.print()}><Icon name="file" size={16} /> Imprimer / enregistrer en PDF</button>
        </div>
      </div>
      <Async state={state}>{(r) => (
        <article className="card report-sheet">
          <header className="report-head"><Logo size={56} /><div><h1>Rapport financier</h1><div className="muted">Jeunesse d'EDJAMBO — {fmtMonth(r.month)}</div></div></header>
          <h2>Synthèse</h2>
          <table className="plain">
            <tbody>
              <tr><td>Solde d'ouverture</td><td className="right">{fmtMoney(r.opening_balance)}</td></tr>
              <tr><td>Cotisations validées ({r.income.payers} membres sur {r.income.active_members}, soit {r.income.rate} %)</td><td className="right">+ {fmtMoney(r.income.total)}</td></tr>
              <tr><td>Dépenses validées</td><td className="right">− {fmtMoney(r.expenses.total)}</td></tr>
              <tr className="total"><td>Solde de clôture</td><td className="right">{fmtMoney(r.closing_balance)}</td></tr>
            </tbody>
          </table>
          {r.income.by_method.length > 0 && <>
            <h2>Cotisations par moyen de paiement</h2>
            <table className="plain"><tbody>{r.income.by_method.map((m) => <tr key={m.label}><td>{m.label} ({m.n})</td><td className="right">{fmtMoney(m.total)}</td></tr>)}</tbody></table>
          </>}
          <h2>Dépenses du mois</h2>
          {r.expenses.items.length ? (
            <table className="plain">
              <thead><tr><th>Date</th><th>Catégorie</th><th>Objet</th><th className="right">Montant</th></tr></thead>
              <tbody>{r.expenses.items.map((e) => <tr key={e.id}><td className="nowrap">{fmtDate(e.spent_at)}</td><td>{e.category_label}</td><td>{e.description}{e.has_receipt ? ' ✓' : ''}</td><td className="right nowrap">{fmtMoney(e.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}><b>Total</b></td><td className="right"><b>{fmtMoney(r.expenses.total)}</b></td></tr></tfoot>
            </table>
          ) : <p className="muted">Aucune dépense validée ce mois-ci.</p>}
          <p className="small muted">✓ = justificatif conservé. Les dépenses sont validées par deux responsables distincts avant d'être comptabilisées.</p>
          <div className="signatures"><div>Le Trésorier<br /><span /></div><div>Le Président<br /><span /></div></div>
        </article>
      )}</Async>
    </div>
  );
}

export default function Finance({ page }) {
  return page === 'report' ? <Report /> : <Overview />;
}
