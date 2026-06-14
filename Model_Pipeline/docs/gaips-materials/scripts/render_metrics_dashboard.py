#!/usr/bin/env python3
"""Render operational-metrics.json into a self-contained static dashboard.

Reads the normalised document from `write_operational_metrics.py` and emits a
single `index.html` (plus a copy of the JSON for download) suitable for GitLab
Pages. No external CDN, no JavaScript dependency — inline CSS and SVG only, so it
renders under a strict CSP and survives offline archival as a CI artifact.

The page has four bands:
  1. Gate banner       — passed / failed / skipped headline + per-signal ledger
  2. Pipeline + ops    — commit/ref/status, duration, queue time, jobs by stage
  3. Section cards     — security, supply chain, model integrity, AI eval, data
  4. Sources + metrics — input presence table and the flat numeric metric map
"""

from __future__ import annotations

import argparse
import html
import json
import shutil
from pathlib import Path
from typing import Any


def esc(v: Any) -> str:
    return html.escape("" if v is None else str(v))


def fmt(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:.4g}"
    return esc(v)


def bar(rate: float) -> str:
    """A 0..1 pass-rate bar; red <0.8, amber <1.0, green at 1.0."""
    pct = max(0.0, min(1.0, rate)) * 100
    color = "#3fb950" if rate >= 1.0 else ("#d29922" if rate >= 0.8 else "#f85149")
    return (
        f'<div class="bar"><div class="bar-fill" style="width:{pct:.1f}%;'
        f'background:{color}"></div><span class="bar-label">{rate:.0%}</span></div>'
    )


def sev_chips(by_sev: dict) -> str:
    palette = {
        "critical": "#f85149", "high": "#db6d28", "medium": "#d29922",
        "low": "#3fb950", "negligible": "#6e7681", "unknown": "#6e7681",
        "error": "#f85149", "warning": "#d29922", "info": "#58a6ff",
    }
    chips = []
    for sev, n in by_sev.items():
        c = palette.get(str(sev).lower(), "#6e7681")
        chips.append(f'<span class="chip" style="background:{c}22;border-color:{c}">'
                     f'{esc(sev)}: <b>{esc(n)}</b></span>')
    return '<div class="chips">' + "".join(chips) + "</div>" if chips else "—"


def render_value(key: str, value: Any) -> str:
    """Render a single metric value, special-casing rates and severity maps."""
    if isinstance(value, dict):
        if {"by_severity"} & value.keys():
            inner = sev_chips(value["by_severity"])
            extra = {k: v for k, v in value.items() if k != "by_severity"}
            tail = " ".join(f"<small>{esc(k)}={fmt(v)}</small>" for k, v in extra.items())
            return inner + (f" {tail}" if tail else "")
        return render_kv(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and "pass_rate" in key:
        return bar(float(value))
    if isinstance(value, bool):
        cls = "ok" if value else "bad"
        return f'<span class="pill {cls}">{esc(value)}</span>'
    if isinstance(value, list):
        return esc(", ".join(map(str, value))) if value else "—"
    return fmt(value)


def render_kv(d: dict) -> str:
    rows = "".join(
        f"<tr><th>{esc(k)}</th><td>{render_value(k, v)}</td></tr>"
        for k, v in d.items()
    )
    return f'<table class="kv">{rows}</table>'


SECTION_TITLES = {
    "security": "🔐 Security",
    "supply_chain": "📦 Supply Chain",
    "model_integrity": "🧬 Model Integrity",
    "ai_evaluation": "⚔️ AI Evaluation & Guardrails",
    "data_quality": "📊 Data Quality & Drift",
}


def render_sections(sections: dict) -> str:
    cards = []
    for key, title in SECTION_TITLES.items():
        body = sections.get(key)
        if not body:
            continue
        inner = "".join(
            f'<div class="metric"><h3>{esc(name)}</h3>{render_value(name, val)}</div>'
            for name, val in body.items()
        )
        cards.append(f'<section class="card"><h2>{title}</h2>{inner}</section>')
    return "".join(cards)


def render_gate_ledger(detail: dict) -> str:
    rows = []
    for state, cls in (("failed", "bad"), ("passed", "ok"), ("skipped", "skip")):
        for item in detail.get(state, []):
            rows.append(
                f'<tr class="{cls}"><td><span class="dot {cls}"></span>{state}</td>'
                f'<td>{esc(item.get("signal"))}</td><td>{esc(item.get("detail"))}</td></tr>'
            )
    return ("<table class='ledger'><thead><tr><th>State</th><th>Signal</th>"
            "<th>Detail</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


def render_ops(op: dict) -> str:
    if op.get("skipped"):
        return (f'<section class="card"><h2>⚙️ Operational (GitLab API)</h2>'
                f'<p class="muted">Skipped — {esc(op.get("reason"))}</p></section>')
    head = render_kv({
        "status": op.get("status"), "ref": op.get("ref"), "source": op.get("source"),
        "duration (s)": op.get("duration"), "queued (s)": op.get("queued_duration"),
        "coverage": op.get("coverage"), "jobs": op.get("jobs_total"),
    })
    stage_rows = "".join(
        f"<tr><th>{esc(stage)}</th><td>{sev_chips(statuses)}</td></tr>"
        for stage, statuses in (op.get("jobs_by_stage") or {}).items()
    )
    job_rows = "".join(
        f"<tr><td>{esc(j.get('name'))}</td><td>{esc(j.get('stage'))}</td>"
        f"<td><span class='pill {'ok' if j.get('status')=='success' else ('skip' if j.get('status') in ('skipped','manual') else 'bad')}'>"
        f"{esc(j.get('status'))}</span></td>"
        f"<td>{fmt(j.get('duration'))}</td><td>{fmt(j.get('queued_duration'))}</td></tr>"
        for j in (op.get("jobs") or [])
    )
    return (
        '<section class="card"><h2>⚙️ Operational (GitLab API)</h2>'
        f'{head}'
        f'<h3>Jobs by stage</h3><table class="kv">{stage_rows}</table>'
        '<h3>Jobs</h3><table class="jobs"><thead><tr><th>Job</th><th>Stage</th>'
        '<th>Status</th><th>Duration</th><th>Queue</th></tr></thead>'
        f'<tbody>{job_rows}</tbody></table></section>'
    )


def render_sources(sources: dict) -> str:
    rows = []
    for name, state in sorted(sources.items()):
        cls = "ok" if state == "present" else ("skip" if state == "absent" else "bad")
        rows.append(f'<tr><td>{esc(name)}</td><td><span class="pill {cls}">{esc(state)}</span></td></tr>')
    return ("<table class='kv'><thead><tr><th>Input</th><th>Status</th></tr></thead>"
            "<tbody>" + "".join(rows) + "</tbody></table>")


def render_metrics_table(metrics: dict) -> str:
    rows = "".join(f"<tr><th>{esc(k)}</th><td>{fmt(v)}</td></tr>" for k, v in sorted(metrics.items()))
    return f'<table class="kv">{rows}</table>'


CSS = """
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--fg:#e6edf3;--muted:#8b949e;
--ok:#3fb950;--bad:#f85149;--skip:#6e7681;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;
background:var(--bg);color:var(--fg)}
header.top{padding:24px 32px;border-bottom:1px solid var(--border);background:var(--card)}
header.top h1{margin:0 0 4px;font-size:20px}header.top .meta{color:var(--muted);font-size:13px}
header.top code{background:#0d1117;padding:1px 6px;border-radius:4px;border:1px solid var(--border)}
.banner{display:flex;gap:16px;padding:20px 32px;flex-wrap:wrap}
.banner .tile{flex:1;min-width:120px;padding:16px;border-radius:10px;border:1px solid var(--border);text-align:center}
.banner .tile b{display:block;font-size:30px;line-height:1}
.tile.pass{background:#3fb95015;border-color:var(--ok)}.tile.fail{background:#f8514915;border-color:var(--bad)}
.tile.skip{background:#6e768115;border-color:var(--skip)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;padding:0 32px 32px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px}
.card h2{margin:0 0 14px;font-size:16px;border-bottom:1px solid var(--border);padding-bottom:10px}
.card h3{margin:14px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.metric{margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:13px}
table.kv th{text-align:left;color:var(--muted);font-weight:500;width:45%;vertical-align:top;padding:3px 8px 3px 0}
table.kv td{padding:3px 0;vertical-align:top}
table.jobs th,table.jobs td,table.ledger th,table.ledger td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--border)}
table.jobs thead th,table.ledger thead th{color:var(--muted);font-weight:500}
.bar{position:relative;height:18px;background:#0d1117;border-radius:5px;border:1px solid var(--border);overflow:hidden}
.bar-fill{height:100%}.bar-label{position:absolute;right:6px;top:0;font-size:11px;line-height:18px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:12px;padding:2px 8px;border-radius:12px;border:1px solid}
.pill{font-size:12px;padding:1px 8px;border-radius:10px}
.pill.ok{background:#3fb95022;color:var(--ok)}.pill.bad{background:#f8514922;color:var(--bad)}
.pill.skip{background:#6e768122;color:var(--muted)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}.dot.skip{background:var(--skip)}
.muted{color:var(--muted)}small{color:var(--muted)}
.wide{padding:0 32px 32px}.wide .card{margin-bottom:16px}
a{color:var(--accent)}
"""


def build_html(doc: dict) -> str:
    p = doc.get("pipeline", {})
    op = doc.get("operational", {})
    gates = doc.get("gates", {})
    web = op.get("web_url")
    title_link = f'<a href="{esc(web)}">pipeline #{esc(p.get("id"))}</a>' if web else f'#{esc(p.get("id"))}'

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GAIPS CI Metrics — {esc(p.get('short_sha'))}</title>
<style>{CSS}</style></head><body>
<header class="top">
  <h1>GAIPS CI Operational Metrics</h1>
  <div class="meta">{title_link} · ref <code>{esc(p.get('ref'))}</code>
    · commit <code>{esc(p.get('short_sha'))}</code> · {esc(p.get('project'))}
    · generated {esc(doc.get('generated_at'))}
    · <a href="operational-metrics.json">raw JSON</a></div>
</header>

<div class="banner">
  <div class="tile pass"><b>{esc(gates.get('passed'))}</b>gates passed</div>
  <div class="tile fail"><b>{esc(gates.get('failed'))}</b>gates failed</div>
  <div class="tile skip"><b>{esc(gates.get('skipped'))}</b>skipped / N/A</div>
</div>

<div class="grid">
  {render_ops(op)}
  {render_sections(doc.get('sections', {}))}
</div>

<div class="wide">
  <section class="card"><h2>🚦 Gate ledger</h2>{render_gate_ledger(gates.get('detail', {}))}</section>
  <section class="card"><h2>📥 Input sources</h2>{render_sources(doc.get('sources', {}))}</section>
  <section class="card"><h2>📈 Flat metrics</h2>{render_metrics_table(doc.get('metrics', {}))}</section>
</div>
</body></html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metrics", required=True, help="operational-metrics.json input")
    parser.add_argument("--out-dir", required=True, help="output dir (e.g. public/ for GitLab Pages)")
    args = parser.parse_args()

    metrics_path = Path(args.metrics)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not metrics_path.exists():
        # Keep Pages publishable even if the normaliser produced nothing.
        doc: dict = {"pipeline": {}, "gates": {}, "operational": {"skipped": True,
                     "reason": "operational-metrics.json absent"}, "sections": {},
                     "metrics": {}, "sources": {}}
        print(f"WARNING: {metrics_path} absent — rendering empty dashboard")
    else:
        doc = json.loads(metrics_path.read_text())
        shutil.copyfile(metrics_path, out_dir / "operational-metrics.json")

    (out_dir / "index.html").write_text(build_html(doc), encoding="utf-8")
    print(f"dashboard → {out_dir / 'index.html'}")


if __name__ == "__main__":
    main()
