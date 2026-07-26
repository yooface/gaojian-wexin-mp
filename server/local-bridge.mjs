#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync, backup as backupDatabase } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeHtml, extractStructuredBlocks, htmlToText, parseWechatPublishedAt } from "./content-structure.mjs";
import { progressFromCodexEvent } from "./codex-progress.mjs";
import { friendlyGitCloneError, gitCloneArgs, gitProxyArgs, normalizeProxyUrl, parseWindowsProxy } from "./skill-network.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = path.join(root, "dist", "client");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const gzhSkillPath = path.join(codexHome, "skills", "gzh-design-skill", "SKILL.md");
const angleSchema = path.join(root, "server", "schemas", "angles.schema.json");
const dnaSchema = path.join(root, "server", "schemas", "dna.schema.json");
const outlineSchema = path.join(root, "server", "schemas", "outline.schema.json");
const sectionSchema = path.join(root, "server", "schemas", "section.schema.json");
const draftSchema = path.join(root, "server", "schemas", "draft.schema.json");
const dataRoot = path.join(root, ".gaojian-data");
const dnaFile = path.join(dataRoot, "style-dna.json");
const articlesFile = path.join(dataRoot, "articles.json");
const settingsFile = path.join(dataRoot, "settings.json");
const backupsRoot = path.join(dataRoot, "backups");
const coversRoot = path.join(dataRoot, "assets", "covers");
const databaseFile = path.join(dataRoot, "gaojian.db");
const skillsRoot = path.join(codexHome, "skills");
const claudeSkillsRoot = path.join(claudeHome, "skills");
const port = Number(process.env.GAOJIAN_PORT || 4174);
const codexCommand = process.platform === "win32" ? "codex.cmd" : "codex";
const claudeCommand = process.platform === "win32" ? "claude.cmd" : "claude";
const claudeExecutable = process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
  : "claude";
let lastClaudeRuntime = null;

await mkdir(dataRoot, { recursive: true });
await mkdir(coversRoot, { recursive: true });
const database = new DatabaseSync(databaseFile);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    markdown TEXT NOT NULL DEFAULT '',
    idea TEXT NOT NULL DEFAULT '',
    outline_json TEXT,
    status TEXT NOT NULL DEFAULT '草稿',
    source TEXT NOT NULL DEFAULT '本地草稿',
    theme TEXT,
    layout_html TEXT NOT NULL DEFAULT '',
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS articles_updated_at_idx ON articles(updated_at DESC);
  CREATE INDEX IF NOT EXISTS articles_status_idx ON articles(status);
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS backup_history (
    filename TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    article_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS style_samples (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    blocks_json TEXT NOT NULL DEFAULT '[]',
    paragraph_count INTEGER NOT NULL DEFAULT 0,
    image_count INTEGER NOT NULL DEFAULT 0,
    published_at TEXT NOT NULL DEFAULT '',
    metadata_checked_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);
const styleSampleColumns = new Set(database.prepare("PRAGMA table_info(style_samples)").all().map((column) => column.name));
if (!styleSampleColumns.has("published_at")) database.exec("ALTER TABLE style_samples ADD COLUMN published_at TEXT NOT NULL DEFAULT ''");
if (!styleSampleColumns.has("metadata_checked_at")) database.exec("ALTER TABLE style_samples ADD COLUMN metadata_checked_at TEXT NOT NULL DEFAULT ''");
const articleColumns = new Set(database.prepare("PRAGMA table_info(articles)").all().map((column) => column.name));
if (!articleColumns.has("settings_json")) database.exec("ALTER TABLE articles ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'");
database.prepare("UPDATE style_samples SET metadata_checked_at = '' WHERE published_at = '' AND metadata_checked_at <> '' AND metadata_checked_at NOT LIKE 'v2:%'").run();

function run(command, args, timeout = 12_000, input = null, options = {}) {
  return new Promise((resolve) => {
    // npm installs Codex as a .cmd/.ps1 shim on Windows; the Windows shell resolves it safely here.
    // Every command and argument below is fixed by this bridge, never supplied by the browser.
    const child = spawn(command, args, {
      windowsHide: true,
      shell: options.shell ?? process.platform === "win32",
    });
    let output = "";
    let error = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && options.killTree && child.pid) {
        spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false });
      } else {
        child.kill();
      }
    }, timeout);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    if (input !== null) child.stdin.end(input);
    child.on("error", (reason) => resolve({ ok: false, output: "", error: reason.message }));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        output: output.trim(),
        error: timedOut ? "Command timed out" : error.trim(),
      });
    });
  });
}

function runGit(args, timeout = 12_000, input = null) {
  return run("git", args, timeout, input, { shell: false, killTree: true });
}

function runCodex(args, timeout, input, onProgress, profile) {
  return new Promise((resolve) => {
    const child = spawn(codexCommand, args, { windowsHide: true, shell: process.platform === "win32" });
    let stdoutBuffer = "";
    let error = "";
    let eventError = "";
    const timer = setTimeout(() => child.kill(), timeout);
    const consumeLine = (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === "error") eventError = event.message || event.error?.message || eventError;
        if (event.type === "turn.failed") eventError = event.error?.message || event.message || eventError;
        for (const progress of progressFromCodexEvent(event, profile)) onProgress?.(progress);
      } catch {
        // JSONL is the machine-readable channel. Ignore an isolated non-JSON diagnostic line.
      }
    };
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on("data", (chunk) => { error += chunk; });
    if (input !== null) child.stdin.end(input);
    child.on("error", (reason) => resolve({ ok: false, output: "", error: reason.message }));
    child.on("close", (code) => {
      clearTimeout(timer);
      consumeLine(stdoutBuffer);
      resolve({ ok: code === 0 && !eventError, output: "", error: error.trim() || eventError });
    });
  });
}

function runClaude({ workspace, output, schema, timeout, input, onProgress, profile, tools = "" }) {
  return new Promise(async (resolve) => {
    let schemaJson;
    try {
      schemaJson = JSON.stringify(JSON.parse(await readFile(schema, "utf8")));
    } catch (error) {
      resolve({ ok: false, output: "", error: `无法读取结构化输出规则：${error.message}` });
      return;
    }
    const args = [
      "-p",
      "--verbose",
      "--output-format", "stream-json",
      "--json-schema", schemaJson,
      "--permission-mode", "dontAsk",
      "--tools", tools,
      "--no-session-persistence",
    ];
    const child = spawn(claudeExecutable, args, {
      cwd: workspace,
      windowsHide: true,
      shell: false,
    });
    let stdoutBuffer = "";
    let error = "";
    let eventError = "";
    let structuredOutput = null;
    const timer = setTimeout(() => child.kill(), timeout);
    const consumeLine = (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === "system" && event.subtype === "init") {
          const model = String(event.model || "未知模型");
          const officialModel = /^claude(?:-|$)/i.test(model);
          lastClaudeRuntime = {
            model,
            route: officialModel ? "Anthropic 模型" : "第三方模型路由",
            checkedAt: new Date().toISOString(),
          };
          progress(onProgress, "connect", "连接 Claude Code", `已连接 · ${model}`, "done");
        }
        if (event.type === "assistant") {
          const content = Array.isArray(event.message?.content) ? event.message.content : [];
          if (content.some((item) => item.type === "thinking")) {
            progress(onProgress, "reasoning", profile.reasoning, profile.reasoningDetail);
          }
          if (content.some((item) => item.type === "tool_use" && item.name === "StructuredOutput")) {
            progress(onProgress, "reasoning", profile.reasoning, profile.reasoningDetail, "done");
            progress(onProgress, "compose", profile.compose, profile.composeDetail);
          }
        }
        if (event.type === "result") {
          if (event.is_error || event.subtype !== "success") eventError = event.result || event.error || "Claude Code 执行失败";
          if (event.structured_output) structuredOutput = event.structured_output;
          if (!event.is_error) {
            progress(onProgress, "compose", profile.compose, profile.composeDetail, "done");
            progress(onProgress, "complete", profile.complete, `由 ${event.modelUsage ? Object.keys(event.modelUsage).join("、") : "Claude Code"} 完成`, "done");
          }
        }
      } catch {
        // Claude Code 的 stream-json 频道偶尔会夹带诊断行，忽略单行解析失败。
      }
    };
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on("data", (chunk) => { error += chunk; });
    if (input !== null) child.stdin.end(input);
    child.on("error", (reason) => resolve({ ok: false, output: "", error: reason.message }));
    child.on("close", async (code) => {
      clearTimeout(timer);
      consumeLine(stdoutBuffer);
      if (code === 0 && !eventError && structuredOutput) {
        try {
          await writeFile(output, JSON.stringify(structuredOutput, null, 2), "utf8");
          resolve({ ok: true, output: "", error: "" });
          return;
        } catch (writeError) {
          resolve({ ok: false, output: "", error: writeError.message });
          return;
        }
      }
      resolve({
        ok: false,
        output: "",
        error: error.trim() || String(eventError || "") || (structuredOutput ? "Claude Code 未能保存结果" : "Claude Code 没有返回结构化结果"),
      });
    });
  });
}

function runStructuredAgent(agent, options) {
  if (agent === "claude") {
    return runClaude({
      workspace: options.workspace,
      output: options.output,
      schema: options.schema,
      timeout: options.timeout,
      input: options.prompt,
      onProgress: options.onProgress,
      profile: options.profile,
      tools: options.claudeTools || "",
    });
  }
  return runCodex(options.codexArgs, options.timeout, options.prompt, options.onProgress, options.profile);
}

function progress(onProgress, id, label, detail, status = "active", category = id) {
  onProgress?.({ id, label, detail, status, category });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16 * 1024 * 1024) throw new Error("图片素材总大小不能超过 12MB");
  }
  return JSON.parse(body || "{}");
}

async function generateAngles({ agent = "codex", idea, assets = [], count = 5 }, onProgress) {
  if (typeof idea !== "string" || !idea.trim()) throw new Error("请先输入一个想法或选题");
  const requestedCount = count === 3 ? 3 : 5;
  progress(onProgress, "prepare", "整理想法与素材", `已收到选题${assets.length ? `和 ${Math.min(assets.length, 5)} 个素材` : ""}`);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "gaojian-writing-"));
  const output = path.join(workspace, "angles.json");
  const safeAssets = Array.isArray(assets) ? assets.slice(0, 5) : [];
  let assetNote = safeAssets.length ? `\n用户附带的素材名称：${safeAssets.map((item) => String(item.name || item).slice(0, 120)).join("、")}。这些是可选参考，不要虚构图片中的事实。` : "";
  progress(onProgress, "prepare", "整理想法与素材", "输入内容已整理", "done");
  progress(onProgress, "dna", "读取文风 DNA", "正在匹配表达习惯和可参考片段");
  const dna = await getDna();
  const dnaContext = buildDnaContext(dna, idea);
  progress(onProgress, "dna", "读取文风 DNA", dna ? "文风 DNA 已带入本次任务" : "未找到文风 DNA，将按自然表达生成", "done");
  try {
    const imageArgs = [];
    const claudeImageFiles = [];
    for (const [index, asset] of safeAssets.entries()) {
      const matched = typeof asset.dataUrl === "string" && asset.dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
      if (!matched) continue;
      const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[matched[1]];
      const file = path.join(workspace, `source-${index + 1}.${extension}`);
      await writeFile(file, Buffer.from(matched[2], "base64"));
      imageArgs.push("-i", file);
      claudeImageFiles.push(file);
    }
    if (agent === "claude" && claudeImageFiles.length) {
      assetNote += `\n图片已保存在以下本地文件，请使用 Read 工具逐一查看后再判断：\n${claudeImageFiles.map((file) => `- ${file}`).join("\n")}`;
    }
    const prompt = `你是“稿间”的公众号编辑。基于用户的一个初步想法，给出恰好 ${requestedCount} 个差异足够大的写作角度。每个角度要自然、具体，避免 AI 套话。不要捏造事实或个人经历。标题之间不能只是换同义词，叙事入口、读者收益和核心判断都要有明显差别。禁用“不是……而是……”“不是什么……是……”及同构的先否定再转折句式。\n\n用户想法：${idea.trim().slice(0, 12_000)}${assetNote}\n\n本次写作参考的文风 DNA：\n${dnaContext}\n\n只输出符合指定 JSON Schema 的结果。`;
    progress(onProgress, "connect", agent === "claude" ? "连接 Claude Code" : "连接 Codex CLI", "正在启动本地 Agent");
    const result = await runStructuredAgent(agent, {
      workspace,
      output,
      schema: angleSchema,
      timeout: agent === "claude" ? 180_000 : 90_000,
      prompt,
      onProgress,
      claudeTools: claudeImageFiles.length ? "Read" : "",
      codexArgs: ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-C", workspace, ...imageArgs, "--output-schema", angleSchema, "-o", output, "-"],
      profile: {
      reasoning: "推演不同写作角度",
      reasoningDetail: `正在寻找 ${requestedCount} 个差异足够大的叙事入口`,
      compose: "整理候选角度",
      composeDetail: "正在整理标题、核心判断和读者收益",
      complete: "写作角度生成完成",
      },
    });
    if (!result.ok) throw new Error(result.error || `${agent === "claude" ? "Claude Code" : "Codex"} 未能生成写作角度`);
    progress(onProgress, "validate", "校验候选结果", `正在检查是否完整返回 ${requestedCount} 个角度`);
    const parsed = JSON.parse(await readFile(output, "utf8"));
    if (parsed.angles?.length !== requestedCount) throw new Error(`Codex 未返回 ${requestedCount} 个完整角度，请重新生成`);
    progress(onProgress, "validate", "校验候选结果", `${requestedCount} 个角度均可正常使用`, "done");
    return parsed;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function generateOutline({ agent = "codex", idea, angle, assets = [] }, onProgress) {
  if (typeof idea !== "string" || !idea.trim() || !angle?.title) throw new Error("缺少选题或写作角度");
  progress(onProgress, "prepare", "读取已选写作角度", `正在整理「${angle.title}」的核心方向`);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "gaojian-outline-"));
  const output = path.join(workspace, "outline.json");
  progress(onProgress, "prepare", "读取已选写作角度", "写作角度已确认", "done");
  progress(onProgress, "dna", "匹配结构 DNA", "正在选择适合这篇文章的结构和段落节奏");
  const dna = await getDna();
  const dnaContext = buildDnaContext(dna, idea, { includeExamples: true });
  progress(onProgress, "dna", "匹配结构 DNA", dna ? "已找到可参考的结构与媒体习惯" : "没有可用 DNA，将按内容自然组织", "done");
  const assetNote = Array.isArray(assets) && assets.length ? `用户有这些图片或文件素材：${assets.map((asset) => String(asset.name || asset).slice(0, 100)).join("、")}。只有确实增强理解或情绪时才安排媒体位置。` : "用户没有提供图片；mediaHint 只在确有必要时建议需要补充的真实图片、截图或表情包，否则写“无需媒体”。";
  const prompt = `你是“稿间”的公众号编辑。请根据选题、所选角度和作者的结构 DNA，设计一条柔性的“叙事路线”，不要生成传统作文提纲。

先从 structureProfiles 中选择最适合本篇的一种结构；如果样本结构都不合适，可以给出本篇独有的结构。sectionMode 必须根据内容需要选择：
- 连续叙事：不使用正式小标题，依靠自然段、设问和转场推进。
- 稀疏分节：只在真正换话题时使用 1～3 个小标题。
- 清晰分节：仅适合教程、步骤或复杂拆解，小标题数量也不要求和路线节点一致。

route 是 2～6 个内容节点，只用于提醒写作时经过哪些关键位置，不是文章目录。beat 是给编辑看的短标签；direction 说明该处具体写什么；material 写明必须使用的用户事实/素材，缺失则明确写“需要作者补充什么”；transition 说明怎样自然进入下一处，禁止使用“接下来、首先、其次、最后”；mediaHint 根据作者媒体习惯和本次素材决定；sectionBreak 表示这里是否真的需要出现正文小标题。

不要让每个节点长度、形式和任务对称。允许一段现场连续写很久，也允许一个判断只占一两段。禁止输出“提出问题—分析问题—解决问题”等通用骨架，不得编造事实或个人经历。

用户想法：${idea.slice(0, 12_000)}
选定角度：${angle.title}——${angle.description || ""}
${assetNote}

作者的文风与结构 DNA：
${dnaContext}

只输出符合 JSON Schema 的结果。`;
  try {
    progress(onProgress, "connect", agent === "claude" ? "连接 Claude Code" : "连接 Codex CLI", "正在启动本地 Agent");
    const result = await runStructuredAgent(agent, {
      workspace,
      output,
      schema: outlineSchema,
      timeout: agent === "claude" ? 180_000 : 120_000,
      prompt,
      onProgress,
      codexArgs: ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-C", workspace, "--output-schema", outlineSchema, "-o", output, "-"],
      profile: {
        reasoning: "设计叙事路线",
        reasoningDetail: "正在安排内容节点、自然转场和媒体位置",
        compose: "整理路线结果",
        composeDetail: "正在生成可修改的标题和叙事节点",
        complete: "叙事路线生成完成",
      },
    });
    if (!result.ok) throw new Error(result.error || `${agent === "claude" ? "Claude Code" : "Codex"} 未能生成提纲`);
    progress(onProgress, "validate", "校验叙事路线", "正在检查节点、转场与分节方式");
    const parsed = JSON.parse(await readFile(output, "utf8"));
    progress(onProgress, "validate", "校验叙事路线", "叙事路线完整，可继续修改", "done");
    return parsed;
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

async function generateSection({ idea, outlineTitle, section, previousText = "" }) {
  if (!idea || !outlineTitle || !section?.heading) throw new Error("缺少提纲信息");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "gaojian-section-"));
  const output = path.join(workspace, "section.json");
  const dna = await getDna();
  const dnaContext = buildDnaContext(dna, idea, { includeExamples: true });
  const prompt = `你是“稿间”的公众号编辑。只撰写文章中的一个章节，不要标题、不要总结全文、不要虚构事实。语言必须具体，有真实作者能补充的位置就留出明确但自然的空间。长度 250～450 字。\n\n文章主题：${idea}\n文章标题：${outlineTitle}\n本节标题：${section.heading}\n本节任务：${section.description}\n前文（如有）：${previousText.slice(-1800)}\n文风 DNA：${dnaContext}\n\n只输出符合 JSON Schema 的结果。`;
  try {
    const result = await run(codexCommand, ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-C", workspace, "--output-schema", sectionSchema, "-o", output, "-"], 120_000, prompt);
    if (!result.ok) throw new Error(result.error || "Codex 未能生成这一节");
    return JSON.parse(await readFile(output, "utf8"));
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

async function generateDraft({ agent = "codex", idea, outline, styleStrength = "明显带入" }, onProgress) {
  const route = Array.isArray(outline?.route) ? outline.route : Array.isArray(outline?.sections) ? outline.sections.map((section) => ({ beat: section.stage, direction: section.description, material: "使用用户已经提供的材料", transition: "自然衔接", mediaHint: section.imageHint || "无需媒体", sectionBreak: true })) : [];
  if (!idea || !outline?.title || route.length < 1) throw new Error("叙事路线至少保留一项");
  progress(onProgress, "prepare", "整理确认后的路线", `已读取 ${route.length} 个叙事节点和「${outline.sectionMode || "自然结构"}」`);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "gaojian-draft-"));
  const output = path.join(workspace, "draft.json");
  progress(onProgress, "prepare", "整理确认后的路线", "路线和用户素材已锁定", "done");
  progress(onProgress, "dna", "检索文风 DNA 与原文片段", `正在按「${styleStrength}」匹配语气、节奏和结构`);
  const dna = await getDna();
  const dnaContext = buildDnaContext(dna, idea, { includeExamples: true });
  progress(onProgress, "dna", "检索文风 DNA 与原文片段", dna ? "已带入表达规则、结构习惯和相关原文片段" : "未找到文风 DNA，将按自然表达写作", "done");
  const activeSkillsRoot = agent === "claude" ? claudeSkillsRoot : skillsRoot;
  const humanizerAvailable = (await readdir(activeSkillsRoot, { withFileTypes: true }).catch(() => []))
    .some((entry) => entry.isDirectory() && /humanizer-zh/i.test(entry.name));
  const routeText = route.map((item, index) => `${index + 1}. ${item.beat || `节点 ${index + 1}`}
方向：${item.direction || ""}
材料：${item.material || ""}
转场：${item.transition || "自然进入下一处"}
媒体：${item.mediaHint || "无需媒体"}
建议分节：${item.sectionBreak ? "是" : "否"}`).join("\n\n");
  const strengthInstruction = {
    "轻度参考": "保留作者的基本语气和禁忌，内容清晰优先，不刻意复刻口头表达。",
    "明显带入": "明显呈现作者的句子节奏、段落呼吸、转场和口语密度，同时保持自然。",
    "尽量还原": "尽量贴近原文片段体现的语气、节奏和结构习惯，但不得复制原句或挪用样本事实。",
  }[styleStrength] || "明显呈现作者的句子节奏、段落呼吸、转场和口语密度，同时保持自然。";
  const sectionInstruction = {
    "连续叙事": "正文不要使用任何 ## 小标题。保持自然段呼吸，关键判断可以单独成段。",
    "稀疏分节": "全文只在真正转换话题时使用 1～3 个 ## 小标题，不要把路线节点逐一变成标题。",
    "清晰分节": "可按理解需要使用 ## 小标题，但数量和名称不得机械对应路线节点，各节长度不要对称。",
  }[outline.sectionMode] || "根据内容需要决定小标题，禁止机械对应路线节点。";
  const humanizerInstruction = humanizerAvailable
    ? `\n已安装 $humanizer-zh。必须在同一次任务中读取并应用这个 Skill，对内容初稿完成最后一轮中文去 AI 味审校；它不能覆盖用户事实、文风 DNA 或确认后的路线。不要另起第二次生成，也不要输出审校过程。\n`
    : "\n当前 Agent 未检测到 Humanizer-zh，按下方语言禁令完成内置文风审校。\n";
  const prompt = `你是“稿间”的公众号主笔。请在一次回复中完成整篇文章，并在内部完成“内容初稿→文风审校→最终改写”，只输出审校后的最终稿。${humanizerInstruction}

信息优先级：
1. 用户提供的事实、观点和素材，绝不能改写成虚构经历。
2. 文风 DNA 与原文片段是输出质量标准，不是可选建议。
3. 叙事路线是柔性导航，只保证关键内容不遗漏，不是文章目录或逐项作答清单。允许合并、穿插、调整顺序或缩短节点。

结构要求：${sectionInstruction}
文风浓度：${styleStrength}。${strengthInstruction}
不得编造用户经历、数据或事实；缺少真实材料时，用【请补充：具体需要什么】留下短而明确的占位。文章使用 Markdown，第一行是 # 标题。全文长度由内容决定，不为凑字数重复解释。

语言禁令：全文禁用“不是……而是……”“不是什么……是……”“重点不在……而在……”“与其说……不如说……”以及同构的先否定再转折句式；禁用“首先、其次、最后”“在这个时代”“真正的……从来不是……”等常见 AI 套话。直接陈述事实、判断和因果。完成初稿后自行逐段检查并改写所有违反禁令的句子，不要强行升华。

用户原始想法：${String(idea).slice(0, 12_000)}
确认后的标题：${outline.title}
选定结构：${outline.structureName || "自然结构"}
结构原因：${outline.structureReason || "根据内容需要决定"}
确认后的叙事路线：
${routeText}

文风 DNA 与相关原文片段：
${dnaContext}

只输出符合 JSON Schema 的结果。`;
  try {
    progress(onProgress, "connect", agent === "claude" ? "连接 Claude Code" : "连接 Codex CLI", "正在启动本地 Agent");
    const result = await runStructuredAgent(agent, {
      workspace,
      output,
      schema: draftSchema,
      timeout: agent === "claude" ? 360_000 : 240_000,
      prompt,
      onProgress,
      codexArgs: ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-C", workspace, "--output-schema", draftSchema, "-o", output, "-"],
      profile: {
        reasoning: "组织全文并开始写作",
        reasoningDetail: "正在把素材、路线和文风组合成完整文章",
        compose: humanizerAvailable ? "写作并应用 Humanizer-zh" : "撰写并整理完整初稿",
        composeDetail: humanizerAvailable ? "正在完成全文并进行中文去 AI 味审校" : "正在输出全文并进行文风审校",
        complete: "完整初稿生成完成",
      },
    });
    if (!result.ok) throw new Error(result.error || `${agent === "claude" ? "Claude Code" : "Codex"} 未能生成全文`);
    progress(onProgress, "validate", "进行文风与结构校验", "正在检查 AI 套话、事实边界和 Markdown 结构");
    const parsed = JSON.parse(await readFile(output, "utf8"));
    progress(onProgress, "validate", "进行文风与结构校验", "初稿校验完成", "done");
    return parsed;
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

async function layoutArticle({
  markdown,
  theme,
  showToc = true,
  showSignature = true,
  author = "",
  authorBio = "",
  digest = "",
}) {
  if (!markdown || !theme) throw new Error("缺少文章或主题");
  if (!["摸鱼绿", "红白色系", "石墨极简风", "留白禅意风", "摸鱼票据风", "橄榄手记"].includes(theme)) throw new Error("未知的 GZH Design 主题");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "gaojian-layout-"));
  const source = path.join(workspace, "article.md");
  const output = path.join(workspace, "layout.html");
  await writeFile(source, markdown, "utf8");
  const safeAuthor = String(author || "").trim().slice(0, 60);
  const safeBio = String(authorBio || "").trim().slice(0, 160);
  const safeDigest = String(digest || "").trim().slice(0, 300);
  const signatureInstruction = showSignature && (safeAuthor || safeBio)
    ? `在正文末尾生成作者签名，内容必须使用“我是 ${safeAuthor || "作者"}${safeBio ? `，${safeBio}` : ""}”。不得保留 {{作者名}}、{{简介}} 或任何空模板。`
    : "不要生成作者签名区，也不要保留任何作者占位模板。";
  const digestInstruction = safeDigest
    ? `文章摘要为“${safeDigest}”，只在主题本身包含引言/摘要组件时使用，不得重复插入正文。`
    : "未提供文章摘要，不要添加空摘要组件。";
  const prompt = `使用 $gzh-design skill，把当前工作区的 article.md 按“${theme}”主题排版。严格读取该主题组件库和 common-components.md，生成微信公众号兼容的纯 <section> 正文片段，保存为当前工作区的 layout.html。${showToc ? "保留主题适用的目录/导读组件。" : "不要生成目录或导读组件。"}${signatureInstruction}${digestInstruction}必须运行 skill 的 validate_gzh_html.py，修复到 0 ERROR 和 0 WARNING。不要生成预览外壳，不要改写文章实质内容。完成后只简短报告结果。`;
  try {
    const result = await run(codexCommand, ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "--ephemeral", "-C", workspace, "-"], 300_000, prompt);
    if (!result.ok) throw new Error(result.error || "GZH Design 排版失败");
    if (!await exists(output)) throw new Error("GZH Design 未生成排版文件");
    return { html: await readFile(output, "utf8"), theme };
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

async function listGeneratedImages(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listGeneratedImages(file));
    else if (/\.(png|jpe?g|webp)$/i.test(entry.name) && !/^source-/i.test(entry.name)) files.push(file);
  }
  return files;
}

async function generateCovers({ articleId = "", title, markdown, count = 2 }) {
  if (!title || !markdown) throw new Error("缺少文章标题或正文");
  const coverSkill = path.join(skillsRoot, "baoyu-cover-image", "SKILL.md");
  if (!await exists(coverSkill)) throw new Error("请先在技能库安装 baoyu-skills");
  const requestedCount = count === 1 ? 1 : 2;
  const safeId = String(articleId || randomUUID()).replace(/[^A-Za-z0-9-]/g, "").slice(0, 80) || randomUUID();
  const folderName = `${safeId}-${Date.now()}`;
  const workspace = path.join(coversRoot, folderName);
  await mkdir(path.join(workspace, ".baoyu-skills", "baoyu-cover-image"), { recursive: true });
  await writeFile(path.join(workspace, "article.md"), `# ${String(title).slice(0, 180)}\n\n${String(markdown).slice(0, 120_000)}`, "utf8");
  await writeFile(path.join(workspace, ".baoyu-skills", "baoyu-cover-image", "EXTEND.md"), `---
preferred_image_backend: auto
preferred_type: auto
preferred_palette: elegant
preferred_rendering: auto
default_aspect: "2.35:1"
quick_mode: true
language: zh
watermark:
  enabled: false
---
`, "utf8");
  const prompt = `使用 $baoyu-cover-image skill 阅读当前目录的 article.md，为这篇微信公众号文章直接生成 ${requestedCount} 个彼此明显不同的封面候选。跳过确认，使用 quick 模式；比例 2.35:1，中文，只保留清晰的文章标题，不要副标题和水印。每个候选保存到独立目录 candidate-1、candidate-2（如果只生成一个则只用 candidate-1）。必须输出真实 PNG/JPG 位图，不得使用 SVG、HTML 或 CSS 代替。`;
  const result = await run(codexCommand, ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "--ephemeral", "-C", workspace, "-"], 600_000, prompt);
  if (!result.ok) throw new Error(result.error || "封面生成未完成，请检查图片生成能力是否可用");
  const images = (await listGeneratedImages(workspace)).slice(0, requestedCount);
  if (!images.length) throw new Error("baoyu-cover-image 已运行，但没有找到生成的图片。请检查图片后端配置。");
  return {
    covers: images.map((file, index) => ({
      id: `${folderName}-${index + 1}`,
      url: `/api/covers/${encodeURIComponent(folderName)}/${path.relative(workspace, file).split(path.sep).map(encodeURIComponent).join("/")}`,
    })),
  };
}

async function getDna() {
  const row = database.prepare("SELECT value_json FROM app_state WHERE key = ?").get("style_dna");
  try {
    if (!row) return null;
    const dna = JSON.parse(row.value_json);
    const sourceArticles = getStyleSamples().map((sample) => ({ id: sample.id, title: sample.title, url: sample.url, publishedAt: sample.publishedAt, metadataCheckedAt: sample.metadataCheckedAt }));
    return { ...dna, sourceArticles };
  } catch { return null; }
}

function getStyleSamples() {
  return database.prepare("SELECT * FROM style_samples ORDER BY created_at DESC").all().map((row) => ({
    id: row.id,
    title: row.title,
    url: row.source_url,
    content: row.content,
    blocks: JSON.parse(row.blocks_json || "[]"),
    paragraphCount: Number(row.paragraph_count),
    imageCount: Number(row.image_count),
    publishedAt: row.published_at || "",
    metadataCheckedAt: row.metadata_checked_at || "",
  }));
}

function topicTokens(value) {
  const normalized = String(value || "").toLowerCase().replace(/\s+/g, "");
  const chunks = normalized.match(/[\u3400-\u9fff]{2,12}|[a-z0-9]{3,}/g) || [];
  const tokens = new Set(chunks);
  for (const chunk of chunks.filter((item) => /[\u3400-\u9fff]/.test(item))) {
    for (let index = 0; index < chunk.length - 1; index += 1) tokens.add(chunk.slice(index, index + 2));
  }
  return [...tokens].slice(0, 80);
}

function selectStyleExcerpts(topic, dna, limit = 5) {
  const samples = getStyleSamples();
  const tokens = topicTokens(topic);
  const candidates = [];
  for (const sample of samples) {
    const paragraphs = sample.content.split(/\n+/).map((item) => item.trim()).filter((item) => item.length >= 24 && item.length <= 320);
    for (const [index, paragraph] of paragraphs.entries()) {
      const lowered = paragraph.toLowerCase();
      const overlap = tokens.reduce((score, token) => score + (lowered.includes(token) ? Math.min(6, token.length) : 0), 0);
      const rhythmBonus = paragraph.length >= 35 && paragraph.length <= 180 ? 2 : 0;
      const openingBonus = index < 3 ? 1 : 0;
      candidates.push({ sampleId: sample.id, title: sample.title, excerpt: paragraph, score: overlap + rhythmBonus + openingBonus });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.excerpt.length - b.excerpt.length);
  const selected = [];
  const perSample = new Map();
  for (const candidate of candidates) {
    if ((perSample.get(candidate.sampleId) || 0) >= 2) continue;
    if (selected.some((item) => item.excerpt === candidate.excerpt)) continue;
    selected.push(candidate);
    perSample.set(candidate.sampleId, (perSample.get(candidate.sampleId) || 0) + 1);
    if (selected.length >= limit) break;
  }
  if (!selected.length && Array.isArray(dna?.voiceExamples)) {
    return dna.voiceExamples.slice(0, limit).map((item) => ({ title: item.role, excerpt: item.excerpt }));
  }
  return selected;
}

function buildDnaContext(dna, topic = "", { includeExamples = false } = {}) {
  if (!dna) return "尚未建立文风 DNA。保持自然、具体，不使用套话，也不要伪造个人经历。";
  const parts = [
    `表达总览：${dna.summary}`,
    `表达规则：\n${(dna.rules || []).map((rule) => `- ${rule.label}：${rule.text}`).join("\n")}`,
  ];
  if (Array.isArray(dna.structureProfiles)) {
    parts.push(`常用结构（按内容选择，禁止机械套用）：\n${dna.structureProfiles.map((profile) => `- ${profile.name}｜适合：${profile.fit}｜推进：${profile.flow}｜分节：${profile.sectioning}`).join("\n")}`);
  }
  if (dna.layoutHabits) parts.push(`版式节奏：${dna.layoutHabits.paragraphRhythm}；${dna.layoutHabits.sectioning}；${dna.layoutHabits.emphasis}`);
  if (dna.mediaHabits) parts.push(`媒体习惯：图片——${dna.mediaHabits.images}；表情包/GIF——${dna.mediaHabits.memes}；位置——${dna.mediaHabits.placement}`);
  if (includeExamples) {
    const excerpts = selectStyleExcerpts(topic, dna);
    if (excerpts.length) parts.push(`原文表达片段（只学习语气、节奏和转场，严禁挪用其中事实）：\n${excerpts.map((item, index) => `【片段 ${index + 1}｜${item.title}】${item.excerpt}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

async function readJsonFile(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJsonFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

async function getArticles() {
  return database.prepare("SELECT * FROM articles ORDER BY updated_at DESC").all().map((row) => ({
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    markdown: row.markdown,
    idea: row.idea,
    outline: row.outline_json ? JSON.parse(row.outline_json) : null,
    status: row.status,
    source: row.source,
    theme: row.theme,
    layoutHtml: row.layout_html,
    articleSettings: JSON.parse(row.settings_json || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function saveArticle(input, forcedId = null) {
  const now = new Date().toISOString();
  const id = forcedId || input.id || randomUUID();
  const existing = (await getArticles()).find((article) => article.id === id);
  const markdown = String(input.markdown || existing?.markdown || "").slice(0, 500_000);
  const titleFromMarkdown = markdown.match(/^#\s+(.+)$/m)?.[1];
  const article = {
    id,
    title: String(input.title || titleFromMarkdown || existing?.title || "未命名文章").slice(0, 180),
    excerpt: String(input.excerpt || markdown.replace(/^#+\s+/gm, "").replace(/\s+/g, " ").slice(0, 120) || existing?.excerpt || ""),
    markdown,
    idea: String(input.idea ?? existing?.idea ?? "").slice(0, 20_000),
    outline: input.outline ?? existing?.outline ?? null,
    status: ["草稿", "已排版", "已发布"].includes(input.status) ? input.status : existing?.status || "草稿",
    source: String(input.source || existing?.source || "本地草稿").slice(0, 40),
    theme: input.theme ?? existing?.theme ?? null,
    layoutHtml: String(input.layoutHtml ?? existing?.layoutHtml ?? "").slice(0, 2_000_000),
    articleSettings: input.articleSettings && typeof input.articleSettings === "object"
      ? input.articleSettings
      : existing?.articleSettings || {},
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  };
  database.prepare(`
    INSERT INTO articles (id, title, excerpt, markdown, idea, outline_json, status, source, theme, layout_html, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      excerpt = excluded.excerpt,
      markdown = excluded.markdown,
      idea = excluded.idea,
      outline_json = excluded.outline_json,
      status = excluded.status,
      source = excluded.source,
      theme = excluded.theme,
      layout_html = excluded.layout_html,
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `).run(article.id, article.title, article.excerpt, article.markdown, article.idea, article.outline ? JSON.stringify(article.outline) : null, article.status, article.source, article.theme, article.layoutHtml, JSON.stringify(article.articleSettings), article.createdAt, article.updatedAt);
  return article;
}

function getWritingWorkspaces() {
  const row = database.prepare("SELECT value_json FROM app_state WHERE key = ?").get("writing_workspaces");
  if (!row) return { activeWorkspaceId: "", workspaces: [] };
  try {
    const value = JSON.parse(row.value_json);
    return {
      activeWorkspaceId: String(value.activeWorkspaceId || ""),
      workspaces: Array.isArray(value.workspaces) ? value.workspaces.slice(0, 12) : [],
    };
  } catch {
    return { activeWorkspaceId: "", workspaces: [] };
  }
}

function saveWritingWorkspaces(input) {
  const workspaces = (Array.isArray(input.workspaces) ? input.workspaces : []).slice(0, 12).map((workspace) => ({
    id: String(workspace.id || randomUUID()).slice(0, 120),
    articleId: workspace.articleId ? String(workspace.articleId).slice(0, 120) : null,
    label: String(workspace.label || "未命名文章").slice(0, 180),
    snapshot: workspace.snapshot && typeof workspace.snapshot === "object" ? workspace.snapshot : {},
  }));
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === input.activeWorkspaceId)
    ? String(input.activeWorkspaceId)
    : workspaces[0]?.id || "";
  const value = { activeWorkspaceId, workspaces };
  const encoded = JSON.stringify(value);
  if (encoded.length > 4_000_000) throw new Error("打开的写作任务过多，请关闭部分任务后再试");
  database.prepare(`
    INSERT INTO app_state (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run("writing_workspaces", encoded, new Date().toISOString());
  return value;
}

async function deleteArticle(id) {
  const result = database.prepare("DELETE FROM articles WHERE id = ?").run(id);
  if (!result.changes) throw new Error("没有找到这篇文章");
  return { deleted: true, id };
}

const defaultSettings = {
  model: "自动选择",
  reasoning: "中等",
  workspacePath: dataRoot,
  restricted: true,
  permissionNotice: true,
  autosave: true,
  angleCount: 5,
  styleStrength: "明显带入",
  backupRetention: 20,
};

async function getSettings() {
  const row = database.prepare("SELECT value_json FROM app_state WHERE key = ?").get("settings");
  try { return { ...defaultSettings, ...(row ? JSON.parse(row.value_json) : {}) }; }
  catch { return { ...defaultSettings }; }
}

async function saveSettings(input) {
  const current = await getSettings();
  const settings = {
    ...current,
    model: ["自动选择", "高质量优先", "速度优先"].includes(input.model) ? input.model : current.model,
    reasoning: ["低", "中等", "高"].includes(input.reasoning) ? input.reasoning : current.reasoning,
    workspacePath: String(input.workspacePath || current.workspacePath).slice(0, 500),
    restricted: Boolean(input.restricted),
    permissionNotice: Boolean(input.permissionNotice),
    autosave: Boolean(input.autosave),
    angleCount: input.angleCount === 3 ? 3 : 5,
    styleStrength: ["轻度参考", "明显带入", "尽量还原"].includes(input.styleStrength) ? input.styleStrength : current.styleStrength,
    backupRetention: Math.min(100, Math.max(3, Number(input.backupRetention) || 20)),
    updatedAt: new Date().toISOString(),
  };
  database.prepare(`
    INSERT INTO app_state (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run("settings", JSON.stringify(settings), settings.updatedAt);
  return settings;
}

async function migrateLegacyJson() {
  const articleCount = Number(database.prepare("SELECT COUNT(*) AS count FROM articles").get().count);
  if (articleCount === 0) {
    const legacyArticles = await readJsonFile(articlesFile, []);
    if (Array.isArray(legacyArticles)) {
      for (const article of legacyArticles) await saveArticle(article, article.id || null);
    }
  }
  if (!database.prepare("SELECT 1 FROM app_state WHERE key = ?").get("settings")) {
    const legacySettings = await readJsonFile(settingsFile, null);
    if (legacySettings) await saveSettings({ ...defaultSettings, ...legacySettings });
  }
  if (!database.prepare("SELECT 1 FROM app_state WHERE key = ?").get("style_dna")) {
    const legacyDna = await readJsonFile(dnaFile, null);
    if (legacyDna) database.prepare("INSERT INTO app_state (key, value_json, updated_at) VALUES (?, ?, ?)").run("style_dna", JSON.stringify(legacyDna), legacyDna.updatedAt || new Date().toISOString());
  }
}

async function createBackup() {
  const createdAt = new Date().toISOString();
  const filename = `gaojian-backup-${createdAt.replace(/[:.]/g, "-")}.sqlite`;
  const file = path.join(backupsRoot, filename);
  await mkdir(backupsRoot, { recursive: true });
  database.prepare(`
    INSERT INTO app_state (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run("last_backup", JSON.stringify({ createdAt, filename }), createdAt);
  await backupDatabase(database, file);
  const articleCount = (await getArticles()).length;
  database.prepare("INSERT OR REPLACE INTO backup_history (filename, created_at, article_count) VALUES (?, ?, ?)").run(filename, createdAt, articleCount);
  const settings = await getSettings();
  const backups = (await readdir(backupsRoot)).filter((name) => name.endsWith(".sqlite")).sort().reverse();
  for (const old of backups.slice(settings.backupRetention)) {
    await rm(path.join(backupsRoot, old), { force: true });
    database.prepare("DELETE FROM backup_history WHERE filename = ?").run(old);
  }
  return { filename, path: file, createdAt, articleCount };
}

async function listBackups() {
  return database.prepare("SELECT filename, created_at, article_count FROM backup_history ORDER BY created_at DESC").all().map((row) => ({ filename: row.filename, createdAt: row.created_at, articleCount: Number(row.article_count) }));
}

async function deleteBackup(filename) {
  if (!/^gaojian-backup-[A-Za-z0-9TZ-]+\.sqlite$/.test(filename)) throw new Error("无效的备份文件");
  const file = path.join(backupsRoot, filename);
  await rm(file, { force: true });
  await rm(`${file}-shm`, { force: true });
  await rm(`${file}-wal`, { force: true });
  database.prepare("DELETE FROM backup_history WHERE filename = ?").run(filename);
  return { deleted: true, filename };
}

async function listInstalledSkills() {
  try {
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillFile = path.join(skillsRoot, entry.name, "SKILL.md");
      if (!await exists(skillFile)) continue;
      const text = await readFile(skillFile, "utf8");
      const displayName = text.match(/^name:\s*["']?([^"'\r\n]+)/m)?.[1]?.trim() || entry.name;
      const description = text.match(/^description:\s*["']?([^"'\r\n]+)/m)?.[1]?.trim() || "本地 Codex Skill";
      skills.push({ id: entry.name, name: displayName, description, path: path.dirname(skillFile), installed: true });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } catch { return []; }
}

async function findSkillDirectories(rootDirectory, depth = 0) {
  if (depth > 4) return [];
  if (await exists(path.join(rootDirectory, "SKILL.md"))) return [rootDirectory];
  const entries = await readdir(rootDirectory, { withFileTypes: true }).catch(() => []);
  const nested = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || [".git", ".github", "node_modules", "assets", "references", "scripts"].includes(entry.name)) continue;
    nested.push(...await findSkillDirectories(path.join(rootDirectory, entry.name), depth + 1));
  }
  return nested;
}

async function detectGitProxy() {
  const environmentProxy = normalizeProxyUrl(
    process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
    || process.env.ALL_PROXY
    || process.env.all_proxy,
  );
  if (environmentProxy) return environmentProxy;
  if (process.platform !== "win32") return "";

  const registryPath = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
  const [enabled, server] = await Promise.all([
    run("reg.exe", ["query", registryPath, "/v", "ProxyEnable"], 3_000, null, { shell: false }),
    run("reg.exe", ["query", registryPath, "/v", "ProxyServer"], 3_000, null, { shell: false }),
  ]);
  if (!enabled.ok || !server.ok) return "";
  return parseWindowsProxy(enabled.output, server.output);
}

async function cloneGithubRepository(repoUrl, checkout, timeout = 180_000) {
  const proxy = await detectGitProxy();
  const clone = await runGit(gitCloneArgs(repoUrl, checkout, proxy), Math.min(timeout, 60_000));
  if (!clone.ok) throw new Error(friendlyGitCloneError(clone.error, Boolean(proxy)));

  const proxyArgs = gitProxyArgs(proxy);
  const tree = await runGit(
    [...proxyArgs, "-C", checkout, "ls-tree", "-r", "--name-only", "HEAD"],
    15_000,
  );
  if (!tree.ok) throw new Error("无法读取 Skill 仓库结构，请稍后重试");

  const skillFiles = tree.output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter((file) => /(^|\/)SKILL\.md$/i.test(file))
    .filter((file) => !/^(\.claude|\.codex|\.github|node_modules)\//i.test(file));
  if (!skillFiles.length) throw new Error("仓库中没有找到可安装的 SKILL.md");

  const skillDirectories = [...new Set(skillFiles.map((file) => path.posix.dirname(file)))];
  let checkoutResult;
  if (skillDirectories.includes(".")) {
    // A repository-level Skill needs a real branch checkout so a partial clone
    // fetches its promised blobs. `checkout HEAD -- .` leaves those files absent.
    checkoutResult = await runGit([...proxyArgs, "-C", checkout, "checkout"], timeout);
  } else {
    const sparse = await runGit(
      [...proxyArgs, "-C", checkout, "sparse-checkout", "set", "--cone", "--stdin"],
      timeout,
      `${skillDirectories.join("\n")}\n`,
    );
    if (!sparse.ok) throw new Error(friendlyGitCloneError(sparse.error, Boolean(proxy)));
    checkoutResult = await runGit([...proxyArgs, "-C", checkout, "checkout"], timeout);
  }
  if (!checkoutResult.ok) throw new Error(friendlyGitCloneError(checkoutResult.error, Boolean(proxy)));
}

async function installSkillFromGithub(repoUrl) {
  const normalized = String(repoUrl || "").trim().replace(/\/$/, "");
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(normalized)) throw new Error("请输入有效的 GitHub Skill 仓库地址");
  const repoName = normalized.split("/").pop().replace(/\.git$/, "");
  const temp = await mkdtemp(path.join(os.tmpdir(), "gaojian-skill-"));
  const checkout = path.join(temp, "repo");
  try {
    await cloneGithubRepository(normalized, checkout);
    const skillDirectories = await findSkillDirectories(checkout);
    if (!skillDirectories.length) throw new Error("仓库中没有找到可安装的 SKILL.md");
    const targetRoots = [skillsRoot, claudeSkillsRoot];
    await Promise.all(targetRoots.map((targetRoot) => mkdir(targetRoot, { recursive: true })));
    const installedIds = [];
    const skippedIds = [];
    for (const skillDirectory of skillDirectories) {
      const id = skillDirectory === checkout ? repoName : path.basename(skillDirectory);
      let installedSomewhere = false;
      for (const targetRoot of targetRoots) {
        const destination = path.join(targetRoot, id);
        if (await exists(path.join(destination, "SKILL.md"))) continue;
        await cp(skillDirectory, destination, { recursive: true, errorOnExist: true });
        installedSomewhere = true;
      }
      if (installedSomewhere) installedIds.push(id);
      else skippedIds.push(id);
    }
    return {
      installed: true,
      alreadyInstalled: installedIds.length === 0,
      id: installedIds[0] || skippedIds[0] || repoName,
      installedIds,
      skippedIds,
    };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function analyzeDna({ articles }) {
  if (!Array.isArray(articles) || articles.length < 3) throw new Error("请至少添加 3 篇文章");
  const cleaned = articles.slice(0, 10).map((article, index) => {
    const content = String(article.content || "").trim().slice(0, 20_000);
    const providedBlocks = Array.isArray(article.blocks) ? article.blocks.slice(0, 600) : [];
    const blocks = providedBlocks.length ? providedBlocks : content.split(/\n+/).filter(Boolean).map((text) => ({ type: "paragraph", text }));
    return {
      id: randomUUID(),
      title: String(article.title || `样本 ${index + 1}`).slice(0, 120),
      url: String(article.url || "").slice(0, 2_000),
      content,
      blocks,
      paragraphCount: blocks.filter((block) => block.type === "paragraph" || block.type === "heading").length,
      imageCount: blocks.filter((block) => ["image", "gif", "emoji"].includes(block.type)).length,
      publishedAt: String(article.publishedAt || "").slice(0, 80),
      metadataCheckedAt: String(article.metadataCheckedAt || (article.url ? `v2:${new Date().toISOString()}` : "")).slice(0, 80),
    };
  }).filter((article) => article.content.length >= 200);
  if (cleaned.length < 3) throw new Error("至少 3 篇文章需要各有 200 字以上正文");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "gaojian-dna-"));
  const output = path.join(workspace, "dna.json");
  const source = cleaned.map((article, index) => {
    const sequence = article.blocks.map((block) => {
      if (block.type === "image") return `[图片｜位于第 ${block.position ?? "?"} 段后｜${block.alt || "无说明"}]`;
      if (block.type === "gif") return `[GIF/表情包｜位于第 ${block.position ?? "?"} 段后｜${block.alt || "无说明"}]`;
      if (block.type === "emoji") return `[行内表情｜${block.alt || "无说明"}]`;
      return block.type === "heading" ? `[小标题] ${block.text}` : block.text;
    }).join("\n");
    return `\n## 样本 ${index + 1}：${article.title}\n[结构统计] ${article.paragraphCount} 个文字段落，${article.imageCount} 个图片/GIF/表情节点\n${sequence.slice(0, 24_000)}`;
  }).join("\n");
  const prompt = `你是“稿间”的资深中文编辑。请从以下真实样本中提炼“文风 DNA 2.0”。它不是固定模板，而是一组有条件的表达、结构、版式和媒体习惯。

要求：
- summary 用 100～180 字概括作者最稳定的写作气质。
- rules 写 4～8 条可执行的表达规则，覆盖口语密度、句子节奏、转场、论证/叙事方式和明确禁忌。
- structureProfiles 提炼 1～4 种真实存在的结构原型。每种写清适合什么内容、通常怎样流动、何时分节。不能把所有文章强行归为一种结构，也不能输出“开场—展开—结尾”之类空模板。
- layoutHabits 归纳自然段节奏、小标题使用条件和关键句强调方式。区分“不分节”和“不分自然段”。
- mediaHabits 只能根据样本中真实保留下来的图片/GIF/表情节点归纳。没有足够证据就明确写“样本不足”，严禁猜测。
- voiceExamples 从原文中逐字截取 4～10 个短片段，每段 20～100 字，分别体现开头、转场、解释、吐槽或收束等作用；lesson 只解释值得学习的节奏和表达方法。不要改写原句。
- 所有结论必须来自样本，不得编造作者经历、口头禅或媒体习惯。

${source}

只输出符合 JSON Schema 的结果。`;
  try {
    const result = await run(codexCommand, ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-C", workspace, "--output-schema", dnaSchema, "-o", output, "-"], 240_000, prompt);
    if (!result.ok) throw new Error(result.error || "Codex 未能生成文风 DNA");
    const dna = {
      ...(JSON.parse(await readFile(output, "utf8"))),
      version: 2,
      articles: cleaned.map(({ title }) => title),
      sourceStats: {
        sampleCount: cleaned.length,
        paragraphCount: cleaned.reduce((total, article) => total + article.paragraphCount, 0),
        imageCount: cleaned.reduce((total, article) => total + article.imageCount, 0),
      },
      updatedAt: new Date().toISOString(),
    };
    database.exec("BEGIN");
    try {
      database.prepare("DELETE FROM style_samples").run();
      const insert = database.prepare("INSERT INTO style_samples (id, title, source_url, content, blocks_json, paragraph_count, image_count, published_at, metadata_checked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const article of cleaned) insert.run(article.id, article.title, article.url, article.content, JSON.stringify(article.blocks), article.paragraphCount, article.imageCount, article.publishedAt, article.metadataCheckedAt, dna.updatedAt);
      database.prepare(`
        INSERT INTO app_state (key, value_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run("style_dna", JSON.stringify(dna), dna.updatedAt);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return await getDna();
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

function validateWechatUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("请输入有效的公众号文章链接"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "mp.weixin.qq.com") throw new Error("目前仅支持 mp.weixin.qq.com 公众号文章链接");
  return parsed;
}

async function fetchWechatHtml(url) {
  const parsed = validateWechatUrl(url);
  const response = await fetch(parsed, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "accept-language": "zh-CN,zh;q=0.9" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`公众号页面暂时无法访问（${response.status}）`);
  return response.text();
}

async function extractWechatArticle({ url }) {
  const html = await fetchWechatHtml(url);
  const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/var\s+msg_title\s*=\s*['"]([^'"]+)/i);
  const contentMatch = html.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<script/i) || html.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i);
  const blocks = contentMatch ? extractStructuredBlocks(contentMatch[1]) : [];
  const content = blocks.filter((block) => block.text).map((block) => block.text).join("\n\n") || (contentMatch ? htmlToText(contentMatch[1]) : "");
  if (content.length < 200) throw new Error("未能读到正文。该文章可能受权限或公众号风控限制，请粘贴正文兜底。");
  const metadataCheckedAt = `v2:${new Date().toISOString()}`;
  return {
    title: titleMatch ? decodeHtml(titleMatch[1]) : "未命名文章",
    content,
    blocks,
    publishedAt: parseWechatPublishedAt(html),
    metadataCheckedAt,
    structure: {
      paragraphCount: blocks.filter((block) => block.type === "paragraph" || block.type === "heading").length,
      headingCount: blocks.filter((block) => block.type === "heading").length,
      imageCount: blocks.filter((block) => block.type === "image").length,
      gifCount: blocks.filter((block) => block.type === "gif").length,
      emojiCount: blocks.filter((block) => block.type === "emoji").length,
    },
  };
}

async function refreshStyleSampleMetadata() {
  const pending = database.prepare("SELECT id, source_url FROM style_samples WHERE source_url <> '' AND published_at = '' AND metadata_checked_at = '' LIMIT 20").all();
  await Promise.all(pending.map(async (sample) => {
    const checkedAt = `v2:${new Date().toISOString()}`;
    try {
      const html = await fetchWechatHtml(sample.source_url);
      database.prepare("UPDATE style_samples SET published_at = ?, metadata_checked_at = ? WHERE id = ?").run(parseWechatPublishedAt(html), checkedAt, sample.id);
    } catch {
      database.prepare("UPDATE style_samples SET metadata_checked_at = ? WHERE id = ?").run(checkedAt, sample.id);
    }
  }));
  return getDna();
}

async function exists(file) {
  try { await access(file, constants.F_OK); return true; } catch { return false; }
}

async function getStatus() {
  const version = await run(codexCommand, ["--version"]);
  const login = version.ok ? await run(codexCommand, ["login", "status"]) : { ok: false, output: "" };
  const claudeVersion = await run(claudeCommand, ["--version"]);
  const claudeAuth = claudeVersion.ok ? await run(claudeCommand, ["auth", "status", "--json"]) : { ok: false, output: "" };
  let claudeAuthInfo = null;
  try { claudeAuthInfo = JSON.parse(claudeAuth.output); } catch {}
  const thirdPartyConfigured = Boolean(
    process.env.ANTHROPIC_BASE_URL
    || process.env.CLAUDE_CODE_USE_BEDROCK
    || process.env.CLAUDE_CODE_USE_VERTEX
    || process.env.CLAUDE_CODE_USE_FOUNDRY
  );
  return {
    codex: { installed: version.ok, version: version.output || null, loggedIn: login.ok, login: login.output || login.error || null },
    claude: {
      installed: claudeVersion.ok,
      version: claudeVersion.output || null,
      authenticated: Boolean(claudeAuthInfo?.loggedIn || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || thirdPartyConfigured),
      authMethod: claudeAuthInfo?.authMethod || (thirdPartyConfigured ? "environment" : null),
      apiProvider: claudeAuthInfo?.apiProvider || (thirdPartyConfigured ? "thirdParty" : null),
      thirdPartyConfigured,
      runtime: lastClaudeRuntime,
    },
    skills: {
      gzhDesign: await exists(gzhSkillPath),
      baoyuCover: await exists(path.join(skillsRoot, "baoyu-cover-image", "SKILL.md")),
      humanizerZh: (await readdir(skillsRoot, { withFileTypes: true }).catch(() => []))
        .some((entry) => entry.isDirectory() && /humanizer-zh/i.test(entry.name)),
    },
  };
}

async function installGzhDesign() {
  if (await exists(gzhSkillPath)) return { installed: true, alreadyInstalled: true };
  const temp = await mkdtemp(path.join(os.tmpdir(), "gaojian-gzh-"));
  const checkout = path.join(temp, "repo");
  const destination = path.dirname(gzhSkillPath);
  try {
    await cloneGithubRepository("https://github.com/isjiamu/gzh-design-skill.git", checkout, 60_000);
    if (!await exists(path.join(checkout, "SKILL.md"))) throw new Error("下载内容不是有效的 Codex Skill");
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(checkout, destination, { recursive: true, errorOnExist: true });
    return { installed: true, alreadyInstalled: false };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };
function send(res, status, body, type = "application/json; charset=utf-8") { res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(body); }
async function streamResult(res, task) {
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "x-content-type-options": "nosniff",
  });
  const write = (event) => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    const result = await task((payload) => write({ type: "progress", ...payload }));
    write({ type: "result", data: result });
  } catch (error) {
    write({ type: "error", error: error.message || "任务执行失败" });
  } finally {
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

await migrateLegacyJson();

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/status" && req.method === "GET") return send(res, 200, JSON.stringify(await getStatus()));
  if (url.pathname === "/api/library" && req.method === "GET") return send(res, 200, JSON.stringify({ articles: await getArticles() }));
  if (url.pathname === "/api/library" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await saveArticle(await readJson(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  const articleRoute = url.pathname.match(/^\/api\/library\/([A-Za-z0-9-]+)$/);
  if (articleRoute && req.method === "GET") {
    const article = (await getArticles()).find((item) => item.id === articleRoute[1]);
    return article ? send(res, 200, JSON.stringify(article)) : send(res, 404, JSON.stringify({ error: "没有找到这篇文章" }));
  }
  if (articleRoute && req.method === "PUT") {
    try { return send(res, 200, JSON.stringify(await saveArticle(await readJson(req), articleRoute[1]))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (articleRoute && req.method === "DELETE") {
    try { return send(res, 200, JSON.stringify(await deleteArticle(articleRoute[1]))); }
    catch (error) { return send(res, 404, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/settings" && req.method === "GET") return send(res, 200, JSON.stringify(await getSettings()));
  if (url.pathname === "/api/settings" && req.method === "PUT") {
    try { return send(res, 200, JSON.stringify(await saveSettings(await readJson(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/backups" && req.method === "GET") return send(res, 200, JSON.stringify({ backups: await listBackups() }));
  if (url.pathname === "/api/writing/workspaces" && req.method === "GET") return send(res, 200, JSON.stringify(getWritingWorkspaces()));
  if (url.pathname === "/api/writing/workspaces" && req.method === "PUT") {
    try { return send(res, 200, JSON.stringify(saveWritingWorkspaces(await readJson(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/backups" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await createBackup())); }
    catch (error) { return send(res, 500, JSON.stringify({ error: error.message })); }
  }
  const backupRoute = url.pathname.match(/^\/api\/backups\/(gaojian-backup-[A-Za-z0-9TZ-]+\.sqlite)$/);
  if (backupRoute && req.method === "DELETE") {
    try { return send(res, 200, JSON.stringify(await deleteBackup(backupRoute[1]))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/skills" && req.method === "GET") return send(res, 200, JSON.stringify({ skills: await listInstalledSkills() }));
  if (url.pathname === "/api/skills/install" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await installSkillFromGithub((await readJson(req)).repoUrl))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/skills/gzh-design/install" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await installGzhDesign())); }
    catch (error) { return send(res, 500, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/writing/angles" && req.method === "POST") {
    try {
      const payload = await readJson(req);
      if (url.searchParams.get("stream") === "1") return streamResult(res, (onProgress) => generateAngles(payload, onProgress));
      return send(res, 200, JSON.stringify(await generateAngles(payload)));
    } catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/writing/outline" && req.method === "POST") {
    try {
      const payload = await readJson(req);
      if (url.searchParams.get("stream") === "1") return streamResult(res, (onProgress) => generateOutline(payload, onProgress));
      return send(res, 200, JSON.stringify(await generateOutline(payload)));
    } catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/writing/section" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await generateSection(await readJson(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/writing/draft" && req.method === "POST") {
    try {
      const payload = await readJson(req);
      if (url.searchParams.get("stream") === "1") return streamResult(res, (onProgress) => generateDraft(payload, onProgress));
      return send(res, 200, JSON.stringify(await generateDraft(payload)));
    } catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/writing/layout" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await layoutArticle(await readJson(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/writing/cover" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await generateCovers(await readJson(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname.startsWith("/api/covers/") && req.method === "GET") {
    try {
      const relativeParts = url.pathname.slice("/api/covers/".length).split("/").map((part) => decodeURIComponent(part));
      const file = path.resolve(coversRoot, ...relativeParts);
      const coversRootPrefix = `${path.resolve(coversRoot)}${path.sep}`;
      if (!file.startsWith(coversRootPrefix)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
      const content = await readFile(file);
      return send(res, 200, content, types[path.extname(file).toLowerCase()] || "application/octet-stream");
    } catch {
      return send(res, 404, "Cover not found", "text/plain; charset=utf-8");
    }
  }
  if (url.pathname === "/api/dna" && req.method === "GET") return send(res, 200, JSON.stringify(await getDna()));
  if (url.pathname === "/api/dna/samples" && req.method === "GET") return send(res, 200, JSON.stringify({ samples: getStyleSamples() }));
  if (url.pathname === "/api/dna/samples/refresh-metadata" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await refreshStyleSampleMetadata())); }
    catch (error) { return send(res, 500, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/dna/analyze" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await analyzeDna(await readJson(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname === "/api/articles/extract" && req.method === "POST") {
    try { return send(res, 200, JSON.stringify(await extractWechatArticle(await readJson(req)))); }
    catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }
  if (url.pathname.startsWith("/api/")) return send(res, 404, JSON.stringify({ error: "Not found" }));

  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.resolve(clientRoot, relative);
  if (!file.startsWith(clientRoot)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  const selected = await exists(file) ? file : path.join(clientRoot, "index.html");
  try {
    const content = await (await import("node:fs/promises")).readFile(selected);
    send(res, 200, content, types[path.extname(selected)] || "application/octet-stream");
  } catch { send(res, 404, "Run npm run build before starting 稿间。", "text/plain; charset=utf-8"); }
}).listen(port, "127.0.0.1", () => console.log(`稿间本地服务已启动：http://127.0.0.1:${port}`));
