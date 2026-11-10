// Job Radar dashboard: renders data/dashboard.json (real scan output only).
"use strict";

const TZ = "Asia/Taipei";
const STALE_HOURS = 30;

/** LINE rich-menu links use the same public origin but distinct hash views.
 * Keep #status and the unfragmented root as the existing public monitor.
 * #recent and #about behave like separate screens without re-installing
 * the owner's already-linked, per-user LINE rich menu.
 */
function setViewFromHash() {
  const hash = window.location.hash;
  const pages = {
    "#recent": { view: "recent", title: "最新招募" },
    "#about": { view: "about", title: "使用說明" },
    "#faq": { view: "faq", title: "常見問題" },
    "#privacy": { view: "privacy", title: "資料與隱私" },
  };
  const { view, title } = pages[hash] ?? { view: "monitor", title: "監控狀態" };
  const show = view === "monitor" ?
    new Set(["status", "rules", "sources", "recent", "about"]) :
    new Set([view]);
  for (const section of document.querySelectorAll("main > section[id]")) {
    section.hidden = !show.has(section.id);
  }
  const currentTab = (view === "faq" || view === "privacy") ? "#about" :
    view === "monitor" ? "#status" : hash;
  for (const link of document.querySelectorAll(".nav a[href^='#']")) {
    if (link.getAttribute("href") === currentTab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = title + "｜Job Radar";
}

setViewFromHash();
window.addEventListener("hashchange", () => {
  setViewFromHash();
  window.scrollTo(0, 0);
});

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parts = (iso) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
};
const fmt = (iso) => { if (!iso) return "—"; const p = parts(iso); return `${p.month}/${p.day} ${p.hour}:${p.minute}`; };
const fmtDate = (d) => (d ? d.replaceAll("-", "/") : "");
const todayTaipei = () => { const p = parts(new Date().toISOString()); return `${p.year}-${p.month}-${p.day}`; };

function windowTag(item) {
  const w = item.window || {};
  if (!w.start && !w.end) return item.category === "recruitment_campaign" ? ["日期待官方公告", "warn"] : null;
  const today = todayTaipei();
  const range = `${fmtDate(w.start) || "?"}–${fmtDate(w.end) || "?"}`;
  if (w.end && w.end < today) return [`已截止（${range}）`, ""];
  if (w.start && w.start > today) return [`即將報名（${range}）`, "warn"];
  return [`報名中（${range}）`, "ok"];
}

function decisionTag(d) {
  if (!d) return null;
  return d.notify ? ["已通知", "ok"] : [`未通知：${d.reason}`, ""];
}

function nextCheck(schedule) {
  const p = parts(new Date().toISOString());
  const passed = Number(p.hour) * 60 + Number(p.minute) >= schedule.hour * 60 + schedule.minute + 15;
  return `${passed ? "明天" : "今天"} ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")} 左右`;
}

function renderStatus(d) {
  const el = document.getElementById("status");
  const L = d.latest;
  const h = d.health || {};
  if (!L) {
    el.innerHTML = `<span class="badge warn">尚未掃描</span><p class="lead">雷達還沒有完成第一次掃描。</p>`;
    return;
  }
  const ageH = (Date.now() - new Date(L.scanned_at).getTime()) / 36e5;
  let badge, lead;
  if (L.status !== "ok") {
    badge = `<span class="badge bad">✗ 本次掃描失敗</span>`;
    lead = `${fmt(L.scanned_at)} 無法讀取官方來源，<strong>這不代表沒有新招募</strong>。`;
  } else if (ageH > STALE_HOURS) {
    badge = `<span class="badge warn">⚠ 掃描延遲</span>`;
    lead = `最近一次掃描是 ${fmt(L.scanned_at)}，已超過一天沒有更新。`;
  } else {
    badge = `<span class="badge ok">✓ 監控正常</span>`;
    lead = esc(L.summary_text.replace(/^\d\d\/\d\d \d\d:\d\d /, `${fmt(L.scanned_at)} `));
  }
  const c = L.counts || {};
  const why = {};
  for (const it of L.items || []) {
    if (it.status !== "active" || !it.decision || it.decision.notify) continue;
    why[it.decision.reason] = (why[it.decision.reason] || 0) + 1;
  }
  const whyText = Object.entries(why).map(([r, n]) => `${esc(r)} ${n}`).join("／");
  const okSources = (L.sources || []).filter((s) => s.ok).length;
  el.innerHTML = `
    ${badge}
    <p class="lead">${lead}</p>
    <dl>
      <dt>上次成功掃描</dt><dd>${fmt(h.last_success_at)}</dd>
      <dt>本次檢查</dt><dd>${okSources}/${(L.sources || []).length} 個來源正常・相關公告 ${c.relevant ?? 0} 則</dd>
      <dt>新招募／更新</dt><dd>${c.notify ?? 0} 則 → ${c.notify ? "已發通知" : "因此沒有發通知"}${L.baseline_run ? "（首次掃描只建立基準）" : ""}</dd>
      ${whyText ? `<dt>未通知原因</dt><dd>${whyText}</dd>` : ""}
      ${h.consecutive_failures ? `<dt>連續失敗</dt><dd>${h.consecutive_failures} 次</dd>` : ""}
      ${d.pending_alerts ? `<dt>待發通知</dt><dd>${d.pending_alerts} 則（將於下次執行重試）</dd>` : ""}
      <dt>下次檢查</dt><dd>${nextCheck(d.schedule)}</dd>
    </dl>`;
}

function renderSources(d) {
  const ul = document.getElementById("source-list");
  const rows = (d.latest?.sources || []).map((s) => `
    <li>${s.ok ? "✓" : "✗"} <a href="${esc(s.page)}" rel="noopener">${esc(s.name)}</a>
      <span class="muted">${s.ok ? `正常・${s.items} 則公告` : `無法讀取${s.error ? `（${esc(s.error)}）` : ""}`}</span></li>`);
  rows.push(`<li>↳ <a href="https://service.taipower.com.tw/Exam/" rel="noopener">經濟部聯招</a>
    <span class="muted">聯招公告會刊登在中油就業資訊，已一併涵蓋；聯招網站禁止自動擷取，只提供連結。</span></li>`);
  ul.innerHTML = rows.join("");
}

const ORDER = { recruitment_campaign: 0, unknown: 1, archive_guidelines: 2 };

function renderItems(d) {
  const items = [...(d.latest?.items || [])].sort((a, b) =>
    (ORDER[a.category] ?? 9) - (ORDER[b.category] ?? 9) || String(b.published || "").localeCompare(String(a.published || "")));
  const el = document.getElementById("items");
  if (!items.length) { el.innerHTML = `<p class="muted">目前沒有資料。</p>`; return; }
  el.innerHTML = items.map((it) => {
    const tags = [[it.category_label, ""], windowTag(it), decisionTag(it.decision),
      it.status === "source_removed" ? ["官方已下架", "bad"] : null].filter(Boolean);
    const dd = it.decision || {};
    return `<div class="item">
      <div class="title">${esc(it.title || "（官方資料缺標題）")}</div>
      <div class="tags">${tags.map(([t, k]) => `<span class="tag ${k}">${esc(t)}</span>`).join("")}</div>
      <div class="actions"><a href="${esc(it.url)}" rel="noopener">查看官方公告</a>
        <details><summary>展開原因</summary><dl>
          <dt>判斷</dt><dd>${dd.reason ? `${dd.notify ? "已通知" : "未通知"}：${esc(dd.reason)}` : "—"}</dd>
          ${dd.detail ? `<dt>變更</dt><dd>${esc(dd.detail)}</dd>` : ""}
          <dt>判斷時間</dt><dd>${fmt(dd.at)}</dd>
          <dt>刊登日期</dt><dd>${fmtDate(it.published) || "—"}</dd>
          <dt>附件</dt><dd>${it.attachments} 個</dd>
          <dt>首次看到</dt><dd>${fmt(it.first_seen_at)}</dd>
          ${it.removed_at ? `<dt>下架時間</dt><dd>${fmt(it.removed_at)}</dd>` : ""}
        </dl></details></div>
    </div>`;
  }).join("");
}

function renderSent(d) {
  const ul = document.getElementById("sent");
  ul.innerHTML = d.sent.length
    ? d.sent.slice(0, 5).map((s) => `<li>${fmt(s.at)}${s.result === "expired" ? "（過期未發）" : ""}<div class="sent-text">${esc(s.text)}</div></li>`).join("")
    : `<li class="muted">還沒有發過招募通知。</li>`;
}

function renderHistory(d) {
  const ul = document.getElementById("history");
  ul.innerHTML = d.history.slice(0, 7).map((h) =>
    `<li>${h.status === "ok" ? "✓" : "✗"} ${fmt(h.scanned_at)}　${h.status === "ok"
      ? (h.baseline_run ? "建立基準" : `新招募／更新 ${h.counts?.notify ?? 0} 則`) : "掃描失敗"}</li>`).join("")
    || `<li class="muted">尚無紀錄。</li>`;
}

async function main() {
  try {
    const res = await fetch("data/dashboard.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    renderStatus(d); renderSources(d); renderItems(d); renderSent(d); renderHistory(d);
    document.getElementById("recent-state").hidden = true;
    document.getElementById("footer").textContent = `頁面資料產生於 ${fmt(d.generated_at)}（台北時間）・此服務非中油官方`;
  } catch (e) {
    document.getElementById("status").innerHTML =
      `<span class="badge bad">無法載入監控資料</span><p class="lead">請稍後再試。（${esc(e.message)}）</p>`;
    document.getElementById("recent-state").textContent =
      "目前無法載入最新招募資料，這不代表沒有新公告。請稍後再試，或以中油官方就業資訊為準。";
  }
}
main();
