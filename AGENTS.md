# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Product decisions

- The writing composer is a single unified input: images are optional and may be dragged directly into the text box, never presented as a separate required step.
- Image placement guidance belongs beneath its related outline section as a compact nested suggestion, not as a peer outline row.
- AI image generation is not the default; user-supplied images are analyzed as optional writing material.
- Generate the full article in one Codex CLI call after outline confirmation; do not require per-section generation or reconnect for every section.
- The writing desk is a focused Agent workspace. Keep shortcuts, recent drafts, and dashboard-style content out of it; those belong on a future home screen.
- GZH Design preview is the final step of the writing flow, not a standalone sidebar destination.
- Always generate five writing-angle candidates, keep them on one horizontal row, and support regenerating the set in place. Do not expose a candidate-count control.
- User-facing copy must not expose implementation details such as reconnects, sessions, protocol fallbacks, or token-saving internals.
- Generated Chinese copy must avoid “不是……而是……”, “不是什么……是……”, and similar formulaic contrast constructions.
- The publishing preview follows the selected “编辑工作室” layout: compact app header, left theme rail, dominant central preview, and a right inspector for article, cover, body style, and share-card settings.
- The publishing preview remains inside the normal 稿间 application shell. Keep the main navigation visible, keep the preview header and both control rails fixed, and scroll long articles only inside the center preview canvas.
- Desktop persistence uses SQLite as the single source of truth for articles, settings, style DNA, and backup history. Store large image/file assets on disk and keep only paths and metadata in SQLite.
- Do not expose settings that only save a value without affecting behavior. Data location remains read-only until the desktop shell can perform a real database migration.
- Style DNA 2.0 has four layers: expression rules, conditional structure profiles, layout rhythm, and media-placement habits. Keep the original source samples and structured block order in SQLite so writing can retrieve real excerpts instead of relying only on summaries.
- A user-approved writing plan is a flexible narrative route, not a rigid chapter outline. Choose continuous narrative, sparse sections, or clear sections according to the article; route nodes must not map mechanically to Markdown headings.
- Draft generation treats facts and user material as immutable, style DNA and retrieved source excerpts as the output standard, and the narrative route as rearrangeable guidance.
- Style DNA reference articles retain their original URL and publication date. Titles open the source article in a new browser tab; avoid redundant storage-state labels such as “原文已保存”.
- Long-running writing operations expose real Codex CLI JSONL progress. Show safe task phases and actual tool/search activity, elapsed time, validation, and failures; never invent activity or expose private reasoning, raw prompts, commands, or internal implementation logs.
- The publishing-preview header shows “排版预览” once; the global app brand remains in the persistent sidebar. The center preview paper fills the available canvas height even while GZH Design is still generating.
- The writing desk uses a slim open-article task rail below the page header. “＋ 新建文章” starts a fresh Agent workflow, opening an article from the library adds or activates its task, and switching tasks preserves each article’s current writing stage.
- Do not show a persistent “Codex CLI 已连接” badge in the writing-desk header. Choose from detected local Agents inside the composer footer, immediately beside the primary next-step action; the current implementation exposes Codex CLI and leaves room for future local Agents.
- The local-Agent selector uses a product-styled popover that opens upward from the composer footer. Do not use a native HTML select menu; even a single detected Agent should appear as a clean checked menu row, with room for future Agents.
- Images in the writing composer are clipboard-first and drag-first. Support pasting image data directly, dragging images onto the existing input, and a quiet icon-only plus button as the fallback file picker. Do not show a labeled upload button or a permanent drop zone.
- Every open article task, including an unnamed “想法与素材” task, can be closed from the task rail. Closing removes only the workspace tab and never deletes a saved article; when the active task closes, activate its nearest neighbor, and when the final task closes, create a fresh unnamed task automatically.
- The Skill Library follows a light two-column directory: category/search/install controls on the left, recommendations and the installed directory on the right. Keep featured Skills as compact editorial rows; never turn them back into large marketplace cards. Navigation labels are “文章” and “技能库”.
- The three editorially recommended Skills are product integrations, not generic installation suggestions: GZH Design runs during layout, Humanizer-zh runs inside the single full-draft Agent call when available, and baoyu-cover-image runs only when the user requests cover candidates. Other installed Skills remain available to the local Agent but are never silently injected into article generation.
- The Skill Library must expose every installed Skill. Show the first 12 for scanability, then provide an in-place “load more” control; reset the visible page when search or category changes. Keep the status header and every status value centered on the same column axis.
- Claude Code is a first-class local Agent. Do not infer its actual model provider from authentication metadata: third-party routes may still report first-party OAuth. Use the model reported by real stream-json runtime events, and keep Codex CLI and Claude Code selectable from the writer composer.
- Article author, bio, digest, and signature visibility must affect GZH Design output and persist with the article. Never render or export `{{作者名}}`, `{{简介}}`, or another empty signature template. “分享卡片” and “是否原创” do not belong in the preview inspector.
- Cover handling is generation-and-selection, not upload. Use the optional `baoyu-cover-image` capability to generate one or two raster candidates for download; if the Skill or raster backend is unavailable, show the real missing dependency instead of a fake result.
- Visual alignment is a hard quality bar. Whenever an icon and text share a control, label, status, navigation item, or tag, place them in the same flex/grid alignment context, center them on one visual axis, use an explicit gap and line-height, and prevent SVG baseline alignment from shifting the icon. Favor orderly, consistent geometry across the interface.
- Writing-flow stages should use the available workspace width instead of narrow fixed-width wrappers. On narrower screens, dense horizontal choices should stay on one row with a subtle horizontal scrollbar instead of wrapping into uneven rows.
- Route editing fields have stable, aligned heights and cannot be manually resized. Adding media to a route node must immediately show the attached image thumbnail and provide clear replace/add/remove feedback in that same node.
- Codex CLI and Claude Code must always use their official brand glyphs anywhere an Agent identity is shown, including selectors, menus, status strips, run progress, and settings. Never substitute generic terminal, robot, or AI icons for those brands.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
