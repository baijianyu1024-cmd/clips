import { demoPages } from "./adapter.js";
const prefix = "shiye-extension-demo:";
let index = Number(localStorage.getItem(prefix + "pageIndex")) || 0;
function render() {
  const page = demoPages[index];
  document.querySelectorAll("[data-page]").forEach(b => b.classList.toggle("selected", Number(b.dataset.page) === index));
  document.querySelector("#address").textContent = page.url;
  document.querySelector("#article-title").textContent = page.title;
  const content = document.querySelector("#article-content"); content.replaceChildren();
  for (const text of page.text.split("\n\n")) {
    const row = document.createElement("div"); row.className = "paragraph";
    const p = document.createElement("p"); p.textContent = text;
    const button = document.createElement("button"); button.textContent = "摘录 →"; button.title = "将这段文字暂存到侧栏";
    button.addEventListener("click", () => localStorage.setItem(prefix + "pendingSelection", JSON.stringify({ text: window.getSelection()?.toString() || text, sourceUrl: page.url, sourceTitle: page.title, at: Date.now() })));
    row.append(p, button); content.append(row);
  }
}
document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => { index = Number(b.dataset.page); localStorage.setItem(prefix + "pageIndex", JSON.stringify(index)); render(); }));
window.addEventListener("message", e => { if (e.origin === location.origin && e.source === document.querySelector("iframe").contentWindow && e.data?.type === "shiye-demo-page" && [0, 1, 2].includes(e.data.index)) { index = e.data.index; render(); } });
render();
