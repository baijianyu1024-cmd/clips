function conflict(note) {
  return Object.assign(new Error("当前摘要与这份草稿的原版本不一致。草稿已保留，请核对下方当前摘要，再决定是否更新。"), { currentNote: note });
}

export async function saveCoreDraft(cloud, job, text) {
  if (!job?.record || job.purpose !== "core") throw new Error("摘要还未生成完成。");
  text = text.trim();
  if (!text) throw new Error("摘要内容为空。");
  // An omitted legacy baseline may mean no original summary. Only that empty
  // state can be recovered without asking the reader to review an existing one.
  const expected = job.expectedCoreSummaryId ?? null;
  const summary = { ...job.record, scope: String(job.record.scope || "").slice(0, 160), text, origin: "ai", edited: text !== job.text.trim() };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await cloud({})).notes.find(n => n.id === job.noteId);
    if (!current || current.deletedAt || current.archived || current.status === "inbox") throw new Error("请先恢复并开始这篇笔记，摘要草稿仍保留。");
    if (current.coreSummary?.id === summary.id && current.coreSummary.text === text) return current;
    if ((current.coreSummary?.id || null) !== expected || current.coreSummary?.id === summary.id || current.coreSummaryHistory?.some(s => s.id === summary.id)) throw conflict(current);
    try {
      const result = (await cloud({ method: "PATCH", body: { id: job.noteId, revision: current.revision, action: "set_core_summary", expectedCoreSummaryId: expected, coreSummary: summary } })).note;
      if (result.coreSummary?.id !== summary.id || result.coreSummary.text !== text) throw conflict(result);
      return result;
    } catch (e) { if (e.currentNote || e.status !== 409 || attempt === 2) throw e; }
  }
}
