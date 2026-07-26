import assert from "node:assert/strict";
import test from "node:test";
import { extractStructuredBlocks, htmlToText, parseWechatPublishedAt } from "../server/content-structure.mjs";
import { progressFromCodexEvent } from "../server/codex-progress.mjs";

test("preserves paragraph, heading, image, gif, and emoji order", () => {
  const blocks = extractStructuredBlocks(`
    <section>
      <p>第一段，先讲现场。</p>
      <img data-src="https://mmbiz.qpic.cn/example.jpg" alt="现场截图">
      <h2>真的有点东西</h2>
      <p>第二段，继续往下说。</p>
      <img data-src="https://mmbiz.qpic.cn/reaction.gif" data-type="gif" alt="好家伙">
      <img src="https://mmbiz.qpic.cn/emoji.png" class="rich_media_content_emoji" alt="😅">
    </section>
  `);

  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "image", "heading", "paragraph", "gif", "emoji"]);
  assert.equal(blocks[1].position, 1);
  assert.equal(blocks[4].position, 3);
  assert.equal(blocks[2].text, "真的有点东西");
});

test("normalizes rich text into readable fallback text", () => {
  assert.equal(htmlToText("<p>第一段&nbsp;内容</p><p>第二段&#x2026;</p>"), "第一段 内容\n第二段…");
});

test("extracts WeChat publication time from timestamp or metadata", () => {
  assert.equal(parseWechatPublishedAt('var ct = "1710000000";'), "2024-03-09T16:00:00.000Z");
  assert.equal(parseWechatPublishedAt('<meta property="article:published_time" content="2025-07-18T08:30:00+08:00">'), "2025-07-18T00:30:00.000Z");
});

test("maps Codex JSONL events to safe user-facing progress", () => {
  const started = progressFromCodexEvent({ type: "thread.started", thread_id: "thread-1" }, { reasoning: "推演写作角度" });
  assert.deepEqual(started.map((item) => [item.id, item.status]), [["connect", "done"], ["reasoning", "active"]]);
  assert.equal(started[1].label, "推演写作角度");

  const search = progressFromCodexEvent({ type: "item.started", item: { id: "item-2", type: "web_search", query: "private query" } });
  assert.equal(search[0].label, "搜索资料");
  assert.equal(JSON.stringify(search).includes("private query"), false);

  const completed = progressFromCodexEvent({ type: "turn.completed", usage: { input_tokens: 123 } }, { complete: "完整初稿生成完成" });
  assert.equal(completed[0].label, "完整初稿生成完成");
  assert.equal(JSON.stringify(completed).includes("123"), false);
});
