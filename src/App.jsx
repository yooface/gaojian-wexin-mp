import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ArrowLeft,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  CircleNotch,
  ClipboardText,
  ClockCounterClockwise,
  Copy,
  Database,
  DownloadSimple,
  Feather,
  FileText,
  Fingerprint,
  FolderOpen,
  GearSix,
  GithubLogo,
  ImageSquare,
  LinkSimple,
  MagnifyingGlass,
  NotePencil,
  Package,
  PaintBrushBroad,
  PencilSimple,
  Plus,
  PuzzlePiece,
  ShieldCheck,
  Sparkle,
  Trash,
  TrashSimple,
  UploadSimple,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { ClaudeCodeIcon, CodexIcon } from "./AgentBrandIcons";

const navItems = [
  ["writer", "写作台", NotePencil],
  ["dna", "文风 DNA", Fingerprint],
  ["library", "文章", BookOpen],
  ["skills", "技能库", PuzzlePiece],
  ["settings", "设置", GearSix],
];

const themes = [
  ["摸鱼绿", "#07946f", "#eaf7f1"],
  ["红白色系", "#ca3434", "#fff0ef"],
  ["石墨极简风", "#3e4247", "#eff1f3"],
  ["留白禅意风", "#5b7466", "#eff5f0"],
  ["摸鱼票据风", "#497969", "#edf5ef"],
  ["橄榄手记", "#77725a", "#f4f2e7"],
];

function AgentIdentityIcon({ agent, size = 18 }) {
  return agent === "claude" ? <ClaudeCodeIcon size={size} /> : <CodexIcon size={size} />;
}

const writingStageLabels = {
  idea: "想法与素材",
  angles: "选择角度",
  outline: "确认路线",
  draft: "完整初稿",
};

function createWorkspace(article = null) {
  const stage = article?.markdown ? "draft" : article?.outline ? "outline" : "idea";
  const id = `workspace-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  return {
    id,
    articleId: article?.id || null,
    label: article?.title || "未命名文章",
    snapshot: {
      prompt: article?.idea || "",
      stage,
      outline: article?.outline || null,
      draft: article?.markdown ? article : null,
      activeArticleId: article?.id || null,
      saveState: article?.id ? "已保存" : "",
    },
  };
}

function getWorkspaceLabel(workspace) {
  return workspace.snapshot?.draft?.title || workspace.snapshot?.outline?.title || workspace.label || "未命名文章";
}

function getWorkspaceStatus(workspace) {
  const stage = writingStageLabels[workspace.snapshot?.stage] || "想法与素材";
  return workspace.articleId || workspace.snapshot?.activeArticleId
    ? `${stage} · ${workspace.snapshot?.saveState || "已保存"}`
    : stage;
}

const previewSample = {
  previewOnly: true,
  title: "闲鱼代装 Codex 月入过万：谁在替普通人补上那本缺失的说明书？",
  markdown: `# 闲鱼代装 Codex 月入过万：谁在替普通人补上那本缺失的说明书？

> 当 AI 工具越来越强，人和人之间的差距，常常卡在“能不能顺利用起来”。

打开闲鱼搜索 Codex 代装，会看到一批高度相似的商品：包教包会、远程配置、售后无忧。看起来只是一个小众安装服务，背后却藏着更真实的需求。

## 需求旺盛，供给分散

Codex 对熟悉开发环境的人来说很直接，对普通用户却有一连串门槛。环境配置、依赖安装、权限和网络，每一步都可能把人拦住。

## 卖的其实是确定性

用户愿意付费，买下的是一次顺利开始，也是一份有人负责的安心感。

## 工具普及后的新机会

每一次新工具进入大众市场，都会先长出一批帮人跨过门槛的服务。理解这些真实阻力，才能看清机会从哪里出现。`,
};

async function readAgentStream(endpoint, payload, onProgress) {
  const response = await fetch(`${endpoint}?stream=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "本地 Agent 请求失败");
  }
  if (!response.body) throw new Error("当前环境不支持读取 Agent 执行状态");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "progress") onProgress(event);
    if (event.type === "result") result = event.data;
    if (event.type === "error") throw new Error(event.error || "本地 Agent 未能完成任务");
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffer);
  if (!result) throw new Error("本地 Agent 没有返回完整结果");
  return result;
}

function AgentRunPanel({ run }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000)));
    update();
    if (run.status !== "running") return undefined;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [run.startedAt, run.status]);
  const active = run.steps.findLast((step) => step.status === "active") || run.steps.at(-1);
  const RunAgentIcon = run.agent === "claude" ? ClaudeCodeIcon : CodexIcon;
  return <section className={`agent-run-panel ${run.status}`} aria-live="polite">
    <div className="agent-run-head">
      <span className="agent-run-mark"><RunAgentIcon size={21} /></span>
      <div><b>{run.title}</b><small>{run.status === "failed" ? "执行中断" : run.status === "completed" ? "已经完成" : `已运行 ${elapsed} 秒`}</small></div>
      {run.status === "running" ? <CircleNotch className="spin" size={22} /> : run.status === "failed" ? <XCircle size={22} /> : <CheckCircle size={22} />}
    </div>
    <p>{run.error || active?.detail || "正在准备本次任务"}</p>
    <ol>
      {run.steps.map((step) => <li className={step.status} key={step.id}>
        {step.status === "done" ? <CheckCircle size={18} weight="fill" /> : step.status === "error" ? <XCircle size={18} weight="fill" /> : <CircleNotch className="spin" size={18} />}
        <span>{step.label}</span>
      </li>)}
    </ol>
  </section>;
}

function App() {
  const previewRequested = new URLSearchParams(window.location.search).get("screen") === "preview";
  const [page, setPage] = useState(previewRequested ? "preview" : "writer");
  const [toast, setToast] = useState("");
  const [installed, setInstalled] = useState(false);
  const [theme, setTheme] = useState(themes[0]);
  const [articleFilter, setArticleFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [showToc, setShowToc] = useState(true);
  const [showSignature, setShowSignature] = useState(true);
  const [agentStatus, setAgentStatus] = useState(null);
  const [draftArticle, setDraftArticle] = useState(previewRequested ? previewSample : null);
  const [libraryArticles, setLibraryArticles] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [settings, setSettings] = useState({ model: "自动选择", reasoning: "中等", workspacePath: "", restricted: true, permissionNotice: true, autosave: true, angleCount: 5, styleStrength: "明显带入", backupRetention: 20 });
  const [workspaceSession, setWorkspaceSession] = useState(() => {
    const workspace = createWorkspace();
    return { activeWorkspaceId: workspace.id, workspaces: [workspace] };
  });
  const [workspacesReady, setWorkspacesReady] = useState(false);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const refreshAgentStatus = async () => {
    try {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error();
      const status = await response.json();
      setAgentStatus(status);
      setInstalled(status.skills.gzhDesign);
    } catch {
      setAgentStatus({ codex: { installed: false, loggedIn: false }, claude: { installed: false, authenticated: false }, skills: { gzhDesign: false }, unavailable: true });
    }
  };

  const loadLibrary = async () => {
    setLibraryLoading(true);
    try {
      const response = await fetch("/api/library");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setLibraryArticles(result.articles || []);
    } catch { setLibraryArticles([]); }
    finally { setLibraryLoading(false); }
  };

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings");
      const result = await response.json();
      if (response.ok) setSettings(result);
    } catch {}
  };

  const loadWorkspaces = async () => {
    try {
      const response = await fetch("/api/writing/workspaces");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (Array.isArray(result.workspaces) && result.workspaces.length) {
        setWorkspaceSession({
          activeWorkspaceId: result.workspaces.some((workspace) => workspace.id === result.activeWorkspaceId)
            ? result.activeWorkspaceId
            : result.workspaces[0].id,
          workspaces: result.workspaces,
        });
      }
    } catch {}
    finally { setWorkspacesReady(true); }
  };

  useEffect(() => { refreshAgentStatus(); loadLibrary(); loadSettings(); loadWorkspaces(); }, []);

  useEffect(() => {
    if (!workspacesReady) return undefined;
    const timer = window.setTimeout(() => {
      fetch("/api/writing/workspaces", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(workspaceSession),
      }).catch(() => {});
    }, 450);
    return () => window.clearTimeout(timer);
  }, [workspaceSession, workspacesReady]);

  const filteredArticles = useMemo(() => {
    return libraryArticles.filter((article) => {
      const hit = [article.title, article.excerpt, article.source, article.status].join(" ").toLowerCase().includes(search.toLowerCase());
      const matches = articleFilter === "全部" || article.status === articleFilter;
      return hit && matches;
    });
  }, [articleFilter, libraryArticles, search]);

  const openArticle = (article, destination = "writer") => {
    if (destination === "preview") {
      setDraftArticle(article);
      setPage("preview");
      return;
    }
    setWorkspaceSession((current) => {
      const existing = current.workspaces.find((workspace) => workspace.articleId === article.id || workspace.snapshot?.activeArticleId === article.id);
      if (existing) return { ...current, activeWorkspaceId: existing.id };
      const workspace = createWorkspace(article);
      return { activeWorkspaceId: workspace.id, workspaces: [...current.workspaces, workspace].slice(-12) };
    });
    setPage(destination);
  };

  const startNewArticle = () => {
    const workspace = createWorkspace();
    setWorkspaceSession((current) => ({ activeWorkspaceId: workspace.id, workspaces: [...current.workspaces, workspace].slice(-12) }));
    setPage("writer");
  };

  const closeWorkspace = (workspaceId) => {
    setWorkspaceSession((current) => {
      const closingIndex = current.workspaces.findIndex((workspace) => workspace.id === workspaceId);
      if (closingIndex < 0) return current;
      const remaining = current.workspaces.filter((workspace) => workspace.id !== workspaceId);
      if (!remaining.length) {
        const workspace = createWorkspace();
        return { activeWorkspaceId: workspace.id, workspaces: [workspace] };
      }
      const nextActiveId = current.activeWorkspaceId === workspaceId
        ? remaining[Math.min(closingIndex, remaining.length - 1)].id
        : current.activeWorkspaceId;
      return { activeWorkspaceId: nextActiveId, workspaces: remaining };
    });
  };

  const updateWorkspace = (workspaceId, snapshot) => {
    setWorkspaceSession((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => workspace.id === workspaceId ? {
        ...workspace,
        articleId: snapshot.activeArticleId || workspace.articleId || null,
        label: snapshot.draft?.title || snapshot.outline?.title || workspace.label || "未命名文章",
        snapshot,
      } : workspace),
    }));
  };

  return (
    <div className={`app-shell ${page === "preview" ? "preview-workspace" : ""}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage("writer")}>稿间</button>
        <nav aria-label="主导航">
          {navItems.map(([key, label, Icon]) => (
            <button className={`nav-item ${page === key || (page === "preview" && key === "writer") ? "active" : ""}`} key={key} onClick={() => setPage(key)}>
              <Icon size={24} weight="regular" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">本地优先 · 你的内容只在自己的工作区中流动</div>
      </aside>

      <main className="content">
        <div className={`writer-workspaces ${page === "writer" ? "" : "is-hidden"}`}>
          {workspaceSession.workspaces.map((workspace) => <div className={workspaceSession.activeWorkspaceId === workspace.id ? "writer-workspace active" : "writer-workspace"} key={workspace.id}>
            <WriterPage
              workspace={workspace}
              workspaces={workspaceSession.workspaces}
              activeWorkspaceId={workspaceSession.activeWorkspaceId}
              onSelectWorkspace={(workspaceId) => setWorkspaceSession((current) => ({ ...current, activeWorkspaceId: workspaceId }))}
              onCloseWorkspace={closeWorkspace}
              onNewWorkspace={startNewArticle}
              onWorkspaceChange={(snapshot) => updateWorkspace(workspace.id, snapshot)}
              notify={notify}
              agentStatus={agentStatus}
              settings={settings}
              onSaved={loadLibrary}
              onPreview={(draft) => { setDraftArticle(draft); setPage("preview"); }}
            />
          </div>)}
        </div>
        {page === "dna" && <DnaPage notify={notify} />}
        {page === "library" && <LibraryPage search={search} setSearch={setSearch} filter={articleFilter} setFilter={setArticleFilter} articles={filteredArticles} total={libraryArticles.length} loading={libraryLoading} notify={notify} reload={loadLibrary} onEdit={(article) => openArticle(article, "writer")} onPreview={(article) => openArticle(article, "preview")} onNew={startNewArticle} />}
        {page === "preview" && <PreviewPage article={draftArticle} theme={theme} setTheme={setTheme} showToc={showToc} setShowToc={setShowToc} showSignature={showSignature} setShowSignature={setShowSignature} notify={notify} onSaved={loadLibrary} onBack={() => setPage("writer")} onOpenSkills={() => setPage("skills")} agentStatus={agentStatus} />}
        {page === "skills" && <SkillsPage installed={installed} setInstalled={setInstalled} notify={notify} agentStatus={agentStatus} refreshAgentStatus={refreshAgentStatus} />}
        {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} notify={notify} agentStatus={agentStatus} refreshAgentStatus={refreshAgentStatus} />}
      </main>

      {toast && <div className="toast"><Check size={18} weight="bold" />{toast}</div>}
    </div>
  );
}

function Topbar({ title, subtitle, action, status = true, agentStatus }) {
  return <header className="topbar">
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
    <div className="topbar-actions">
      {status && <span className="agent-status"><CodexIcon size={19} /> {agentStatus?.codex?.loggedIn ? "Codex CLI 已连接" : agentStatus?.unavailable ? "本地服务未启动" : "正在检测 Codex CLI"} {agentStatus?.codex?.loggedIn && <i />}</span>}
      {action}
    </div>
  </header>;
}

function WorkspaceTabs({ workspaces, activeWorkspaceId, onSelect, onClose, onNew }) {
  return <nav className="workspace-tabs" aria-label="打开的文章">
    {workspaces.map((workspace) => <div className={`workspace-tab ${workspace.id === activeWorkspaceId ? "active" : ""}`} key={workspace.id}>
      <button
        className="workspace-tab-main"
        onClick={() => onSelect(workspace.id)}
        title={`${getWorkspaceLabel(workspace)} · ${getWorkspaceStatus(workspace)}`}
      >
        <i />
        <span>{getWorkspaceLabel(workspace)}</span>
        <small>{getWorkspaceStatus(workspace)}</small>
      </button>
      <button className="workspace-close" aria-label={`关闭${getWorkspaceLabel(workspace)}`} title="关闭文章工作区" onClick={() => onClose(workspace.id)}>
        <X size={14} />
      </button>
    </div>)}
    <button className="workspace-new" onClick={onNew} title="新建文章"><Plus size={19} /><span>新建文章</span></button>
  </nav>;
}

function AgentPicker({ agents, value, onChange }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  const current = agents.find((agent) => agent.id === value) || agents[0];
  useEffect(() => {
    const closeFromOutside = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeFromKeyboard = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, []);
  return <div className={`agent-picker-wrap ${open ? "open" : ""}`} ref={pickerRef}>
    <button
      className={`agent-picker ${agents.length ? "" : "unavailable"}`}
      type="button"
      disabled={!agents.length}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((currentOpen) => !currentOpen)}
      title={agents.length ? "选择本地 Agent" : "未检测到可用的本地 Agent"}
    >
      {current ? <AgentIdentityIcon agent={current.id} size={18} /> : <PuzzlePiece size={18} />}
      <span>{current?.label || "未检测到 Agent"}</span>
      <CaretDown size={14} />
    </button>
    {open && <div className="agent-menu" role="listbox" aria-label="选择本地 Agent">
      <small>本机可用</small>
      {agents.map((agent) => <button
        className={agent.id === value ? "selected" : ""}
        type="button"
        role="option"
        aria-selected={agent.id === value}
        key={agent.id}
        onClick={() => { onChange(agent.id); setOpen(false); }}
      >
        <span><AgentIdentityIcon agent={agent.id} size={18} /></span>
        <span className="agent-menu-copy"><b>{agent.label}</b>{agent.detail && <small>{agent.detail}</small>}</span>
        {agent.id === value && <Check size={16} weight="bold" />}
      </button>)}
      <p>更多本地 Agent 可在设置中接入</p>
    </div>}
  </div>;
}

function WriterPage({ workspace, workspaces, activeWorkspaceId, onSelectWorkspace, onCloseWorkspace, onNewWorkspace, onWorkspaceChange, notify, agentStatus, settings, onSaved, onPreview }) {
  const initial = workspace.snapshot || {};
  const [prompt, setPrompt] = useState(initial.prompt || "");
  const [assets, setAssets] = useState([]);
  const assetsRef = useRef([]);
  const [stage, setStage] = useState(initial.stage || "idea");
  const [dragging, setDragging] = useState(false);
  const [angles, setAngles] = useState(initial.angles || null);
  const [generating, setGenerating] = useState(false);
  const [outline, setOutline] = useState(initial.outline || null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [selectedAngle, setSelectedAngle] = useState(initial.selectedAngle || null);
  const [outlineError, setOutlineError] = useState("");
  const [draft, setDraft] = useState(initial.draft || null);
  const [activeArticleId, setActiveArticleId] = useState(initial.activeArticleId || workspace.articleId || null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [saveState, setSaveState] = useState(initial.saveState || (workspace.articleId ? "已保存" : ""));
  const [selectedAgent, setSelectedAgent] = useState(initial.selectedAgent || "codex");
  const [agentRun, setAgentRun] = useState(null);
  const lastSavedMarkdown = useRef(initial.draft?.markdown || "");
  const runAgentTask = async (kind, title, endpoint, payload) => {
    const startedAt = Date.now();
    setAgentRun({ kind, title, agent: selectedAgent, startedAt, status: "running", steps: [], error: "" });
    try {
      const result = await readAgentStream(endpoint, payload, (event) => {
        setAgentRun((current) => {
          if (!current || current.kind !== kind) return current;
          let steps = current.steps.map((step) => step.status === "active" && event.status === "active" && step.id !== event.id ? { ...step, status: "done" } : step);
          const existing = steps.findIndex((step) => step.id === event.id);
          if (existing >= 0) steps = steps.map((step, index) => index === existing ? { ...step, ...event } : step);
          else steps = [...steps, event];
          return { ...current, steps };
        });
      });
      setAgentRun((current) => current?.kind === kind
        ? { ...current, status: "completed", steps: current.steps.map((step) => step.status === "active" ? { ...step, status: "done" } : step) }
        : current);
      return result;
    } catch (error) {
      setAgentRun((current) => current?.kind === kind ? {
        ...current,
        status: "failed",
        error: error.message,
        steps: current.steps.map((step) => step.status === "active" ? { ...step, status: "error" } : step),
      } : current);
      throw error;
    }
  };
  const addAssets = (files, source = "添加", routeKey = null) => {
    const next = Array.from(files || []).filter((file) => file?.type?.startsWith("image/")).map((file, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name || `粘贴的图片-${Date.now()}-${index + 1}`,
      type: "图片",
      file,
      previewUrl: URL.createObjectURL(file),
      routeKey,
    }));
    if (!next.length) return;
    setAssets((current) => [...current, ...next]);
    notify(`${source}了 ${next.length} 张图片，写作时会一并参考`);
  };
  const removeAsset = (index) => {
    setAssets((current) => {
      const target = current[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };
  const handlePromptPaste = (event) => {
    const images = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!images.length) return;
    event.preventDefault();
    const pastedText = event.clipboardData.getData("text/plain");
    if (pastedText) {
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      setPrompt((current) => `${current.slice(0, start)}${pastedText}${current.slice(end)}`);
    }
    addAssets(images, "粘贴");
  };
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => () => {
    assetsRef.current.forEach((asset) => {
      if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl);
    });
  }, []);
  const requestAngles = async () => {
    if (!prompt.trim() && !assets.length) return notify("先写下一点想法，或添加图片素材吧");
    setGenerating(true);
    setSelectedAngle(null);
    setOutlineError("");
    try {
      const payloadAssets = await Promise.all(assets.map(async (asset) => ({ name: asset.name, dataUrl: asset.file?.type.startsWith("image/") ? await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(null); reader.readAsDataURL(asset.file); }) : null })));
      const result = await runAgentTask("angles", "正在生成写作角度", "/api/writing/angles", { agent: selectedAgent, idea: prompt, assets: payloadAssets, count: 5 });
      setAngles(result.angles); setStage("angles");
      notify(`已生成 ${result.angles.length} 个写作角度`);
    } catch (error) { notify(`暂时无法生成：${error.message}`); }
    finally { setGenerating(false); }
  };
  const begin = requestAngles;
  const createOutline = async () => {
    if (!selectedAngle) return;
    setOutlineLoading(true);
    setOutlineError("");
    try {
      const result = await runAgentTask("outline", "正在生成叙事路线", "/api/writing/outline", { agent: selectedAgent, idea: prompt, angle: selectedAngle, assets: assets.map((asset) => ({ name: asset.name })) });
      if (!Array.isArray(result.route) || result.route.length < 2) throw new Error("叙事路线不完整，请重新生成");
      setOutline({
        ...result,
        route: result.route.map((item, index) => ({
          ...item,
          clientId: item.clientId || `route-${Date.now()}-${index}`,
        })),
      });
      setStage("outline"); notify("已生成叙事路线，你可以先修改再开始写作");
    } catch (error) { setOutlineError(error.message); notify(`暂时无法生成：${error.message}`); }
    finally { setOutlineLoading(false); }
  };
  const updateRouteItem = (index, field, value) => setOutline((current) => ({ ...current, route: current.route.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const saveDraft = async (candidate = draft, status = "草稿") => {
    if (!candidate?.markdown) return null;
    setSaveState("保存中…");
    const payload = { ...candidate, id: activeArticleId, title: candidate.title || outline?.title, idea: prompt, outline, status, source: candidate.source || "本地草稿" };
    const response = await fetch(activeArticleId ? `/api/library/${activeArticleId}` : "/api/library", { method: activeArticleId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || "保存失败");
    setActiveArticleId(saved.id);
    setDraft((current) => current ? { ...current, ...saved } : saved);
    lastSavedMarkdown.current = saved.markdown || candidate.markdown;
    setSaveState("已保存");
    onSaved?.();
    return saved;
  };
  const generateFullDraft = async () => {
    setStage("draft"); setDraftLoading(true); setDraftError("");
    try {
      const result = await runAgentTask("draft", "正在生成完整初稿", "/api/writing/draft", { agent: selectedAgent, idea: prompt, outline, styleStrength: settings?.styleStrength || "明显带入" });
      setDraft(result);
      const savedResponse = await fetch(activeArticleId ? `/api/library/${activeArticleId}` : "/api/library", { method: activeArticleId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...result, idea: prompt, outline, status: "草稿", source: "本地草稿" }) });
      const saved = await savedResponse.json();
      if (!savedResponse.ok) throw new Error(saved.error || "初稿已生成，但保存失败");
      setActiveArticleId(saved.id); setDraft({ ...result, ...saved }); setSaveState("已保存"); onSaved?.();
      lastSavedMarkdown.current = saved.markdown || result.markdown;
      notify("全文初稿已生成并保存到文章库");
    }
    catch (error) { setDraftError(error.message); } finally { setDraftLoading(false); }
  };
  useEffect(() => {
    if (!settings?.autosave || !activeArticleId || !draft?.markdown || draftLoading) return;
    if (draft.markdown === lastSavedMarkdown.current) return;
    setSaveState("有修改");
    const timer = window.setTimeout(() => {
      saveDraft(draft).catch(() => setSaveState("保存失败"));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [draft?.markdown]);
  useEffect(() => {
    onWorkspaceChange({
      prompt,
      stage,
      angles,
      outline,
      selectedAngle,
      draft,
      activeArticleId,
      saveState,
      selectedAgent,
    });
  }, [prompt, stage, angles, outline, selectedAngle, draft, activeArticleId, saveState, selectedAgent]);
  const localAgents = [
    agentStatus?.codex?.installed && agentStatus?.codex?.loggedIn ? { id: "codex", label: "Codex CLI" } : null,
    agentStatus?.claude?.installed && agentStatus?.claude?.authenticated ? {
      id: "claude",
      label: "Claude Code",
      detail: agentStatus.claude.runtime?.model || "使用本机已配置的模型路由",
    } : null,
  ].filter(Boolean);
  useEffect(() => {
    if (!localAgents.length || localAgents.some((agent) => agent.id === selectedAgent)) return;
    setSelectedAgent(localAgents[0].id);
  }, [agentStatus?.codex?.loggedIn, agentStatus?.claude?.authenticated]);
  return <section className="page writer-page">
    <Topbar title="写作台" subtitle="把一个念头，慢慢写成一篇文章" status={false} action={<span className="autosave-indicator"><CheckCircle size={18} />{saveState === "保存中…" ? "保存中…" : "自动保存"}</span>} />
    <WorkspaceTabs workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onSelect={onSelectWorkspace} onClose={onCloseWorkspace} onNew={onNewWorkspace} />
    <div className="writing-flow" aria-label="写作流程">
      {[["idea", "想法与素材"], ["angles", "选择角度"], ["outline", "确认路线"], ["draft", "全文初稿"], ["preview", "排版预览"]].map(([key, label], index, steps) => {
        const order = ["idea", "angles", "outline", "draft", "preview"];
        const currentIndex = order.indexOf(stage);
        const className = key === stage ? "active" : index < currentIndex ? "done" : "";
        return <div className="writing-flow-item" key={key}><span className={className}><b>{index + 1}</b>{label}</span>{index < steps.length - 1 && <i />}</div>;
      })}
    </div>
    {stage === "idea" ? <>
      <div className={`writing-field-wrap composer ${dragging ? "is-dragging" : ""} ${generating ? "agent-running" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addAssets(event.dataTransfer.files); }}>
        <label htmlFor="writing-prompt">今天想写什么？</label>
        <textarea id="writing-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onPaste={handlePromptPaste} placeholder="输入选题、观点，或粘贴你的素材…" />
        {assets.length > 0 && <div className="composer-assets">{assets.map((asset, index) => <figure key={`${asset.name}-${index}`}><img src={asset.previewUrl} alt="" /><figcaption>{asset.name}</figcaption><button aria-label={`移除${asset.name}`} title="移除图片" onClick={() => removeAsset(index)}><X size={14} /></button></figure>)}</div>}
        <div className="composer-footer">
          <label className="composer-plus" title="添加图片" aria-label="添加图片"><Plus size={20} /><input type="file" multiple accept="image/*" onChange={(event) => { addAssets(event.target.files); event.target.value = ""; }} /></label>
          <div className="composer-actions">
            <AgentPicker agents={localAgents} value={selectedAgent} onChange={setSelectedAgent} />
            <button className="primary" disabled={generating} onClick={begin}>{generating ? "Agent 处理中…" : "下一步：看看角度"}</button>
          </div>
        </div>
      </div>
      {agentRun?.kind === "angles" && (generating || agentRun.status === "failed") && <AgentRunPanel run={agentRun} />}
    </> : stage === "angles" ? <section className="angle-step">
      <div className="step-heading-row">
        <div className="step-heading"><span>已带入：当前文风 DNA {assets.length ? `· ${assets.length} 个图片/文件素材` : ""}</span><h2>这件事，可以从哪儿写起？</h2><p>先选一个你真正想说的角度。选定后再确认提纲，图片会被放到最合适的段落。</p></div>
        <button className="secondary icon-button regenerate-angles" disabled={generating} onClick={requestAngles}><ArrowsClockwise size={18} />{generating ? "Agent 处理中…" : "重新生成"}</button>
      </div>
      {agentRun?.kind === "angles" && generating && <AgentRunPanel run={agentRun} />}
      <div className="angle-grid">{(angles || []).map((angle) => <button key={angle.title} className={selectedAngle?.title === angle.title ? "selected" : ""} onClick={() => { setSelectedAngle(angle); setOutlineError(""); }}><small>写作角度</small><h3>{angle.title}</h3><p>{angle.description}</p><CaretRight size={20} /></button>)}</div>
      <div className="angle-actions"><button className="text-button back-action" onClick={() => setStage("idea")}><ArrowLeft size={17} /><span>补充想法和素材</span></button><span className={outlineError ? "error" : ""}>{outlineError || (selectedAngle ? `已选择「${selectedAngle.title}」` : "请选择一个写作角度")}</span><button className="primary" disabled={!selectedAngle || outlineLoading} onClick={createOutline}>{outlineLoading ? "Agent 处理中…" : "生成叙事路线"}</button></div>
      {agentRun?.kind === "outline" && (outlineLoading || agentRun.status === "failed") && <AgentRunPanel run={agentRun} />}
    </section> : stage === "outline" ? <section className="outline-step">
      <div className="step-heading"><span>已选择「{outline?.structureName || "自然结构"}」· 正在遵循结构 DNA</span><input className="outline-title-input" value={outline?.title || ""} onChange={(event) => setOutline((current) => ({ ...current, title: event.target.value }))} /><p>{outline?.structureReason || "路线用于保证关键内容不遗漏，写作时允许合并、穿插和调整顺序。"}</p></div>
      <div className="route-mode"><div><b>正文结构</b><span>这决定是否使用正式小标题，不限制自然段。</span></div><div>{["连续叙事", "稀疏分节", "清晰分节"].map((mode) => <button className={outline?.sectionMode === mode ? "active" : ""} key={mode} onClick={() => setOutline((current) => ({ ...current, sectionMode: mode }))}>{mode}</button>)}</div></div>
      <div className="outline-card route-card">{(outline?.route || []).map((item, index) => {
        const routeKey = item.clientId || `route-${index}`;
        const attachedAssets = assets.map((asset, assetIndex) => ({ asset, assetIndex })).filter(({ asset }) => asset.routeKey === routeKey);
        return <div className={`outline-row route-row ${!/^无需/.test(item.mediaHint || "") ? "with-suggestion" : ""}`} key={routeKey}>
        <small>{String(index + 1).padStart(2, "0")}</small>
        <div>
          <input className="outline-heading-input" value={item.beat} onChange={(event) => updateRouteItem(index, "beat", event.target.value)} />
          <textarea className="outline-description-input" value={item.direction} onChange={(event) => updateRouteItem(index, "direction", event.target.value)} />
          <div className="route-details"><label><span>素材落点</span><textarea value={item.material} onChange={(event) => updateRouteItem(index, "material", event.target.value)} /></label><label><span>自然转场</span><textarea value={item.transition} onChange={(event) => updateRouteItem(index, "transition", event.target.value)} /></label></div>
          {outline?.sectionMode !== "连续叙事" && <label className="section-break-toggle"><input type="checkbox" checked={Boolean(item.sectionBreak)} onChange={(event) => updateRouteItem(index, "sectionBreak", event.target.checked)} /><span>这里需要正式小标题</span></label>}
          {!/^无需/.test(item.mediaHint || "") && <div className="image-suggestion">
            <span className="image-suggestion-icon"><ImageSquare size={18} /></span>
            <div className="image-suggestion-copy">
              <b>媒体建议</b>
              <p>{item.mediaHint}</p>
              {attachedAssets.length > 0 && <div className="route-media-assets">{attachedAssets.map(({ asset, assetIndex }) => <figure key={asset.id || `${asset.name}-${assetIndex}`}>
                <img src={asset.previewUrl} alt="" />
                <figcaption>{asset.name}</figcaption>
                <button type="button" title="移除这张图片" aria-label={`移除${asset.name}`} onClick={() => removeAsset(assetIndex)}><X size={12} /></button>
              </figure>)}</div>}
            </div>
            <label className="media-add-button"><Plus size={15} /><span>{attachedAssets.length ? "继续添加" : "添加素材"}</span><input type="file" multiple accept="image/*,.gif" onChange={(event) => { addAssets(event.target.files, "添加", routeKey); event.target.value = ""; }} /></label>
          </div>}
        </div>
        <button className="outline-delete" aria-label={`删除${item.beat}`} title="删除这一项" onClick={() => setOutline((current) => ({ ...current, route: current.route.filter((_, itemIndex) => itemIndex !== index) }))}><TrashSimple size={18} /></button>
      </div>;})}</div>
      <div className="style-strength-row"><div><b>文风浓度</b><span>写作时会同时参考 DNA 和相关原文片段</span></div><strong>{settings?.styleStrength || "明显带入"}</strong></div>
      <div className="outline-actions"><button className="text-button" onClick={() => { setOutline(null); setStage("angles"); }}><ArrowLeft size={17} /> 换一个角度</button><button className="primary" disabled={(outline?.route || []).length < 1} onClick={generateFullDraft}>确认路线，生成全文</button></div>
    </section> : <section className="draft-step"><div className="step-heading"><span>全文初稿 {saveState && `· ${saveState}`}</span><h2>{draft?.title || outline?.title}</h2><p>{draftLoading ? "Codex 正在按确认后的路线写作，下方会显示实时执行状态。" : "全文已经生成。修改会自动保存，也可以直接进入排版。"}</p></div>{draftLoading && agentRun?.kind === "draft" ? <AgentRunPanel run={agentRun} /> : draft ? <div className="full-draft-editor"><textarea value={draft.markdown} onChange={(event) => setDraft((current) => ({ ...current, markdown: event.target.value }))} /><div className="draft-actions"><button className="secondary icon-button" onClick={generateFullDraft}><ArrowsClockwise size={18} />重新生成全文</button><button className="primary" onClick={async () => { try { const saved = await saveDraft(draft); onPreview(saved || draft); } catch (error) { notify(`保存失败：${error.message}`); } }}>进入排版预览</button></div></div> : <div className="draft-loading error"><span>{draftError || "全文生成未完成"}</span><button className="secondary" onClick={() => setStage("outline")}>返回提纲</button><button className="primary" onClick={generateFullDraft}>重试生成全文</button></div>}</section>}
  </section>;
}

function DnaPage({ notify }) {
  const [dna, setDna] = useState(null);
  const [samples, setSamples] = useState([{ url: "", title: "", content: "", error: "" }, { url: "", title: "", content: "", error: "" }, { url: "", title: "", content: "", error: "" }]);
  const [analyzing, setAnalyzing] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/dna");
        const result = await response.json();
        if (!active) return;
        setDna(result);
        const needsMetadata = result?.version === 2 && result.sourceArticles?.some((article) => article.url && !article.publishedAt && !article.metadataCheckedAt);
        if (needsMetadata) {
          const refreshResponse = await fetch("/api/dna/samples/refresh-metadata", { method: "POST" });
          const refreshed = await refreshResponse.json();
          if (active && refreshResponse.ok) setDna(refreshed);
        }
      } catch {}
    })();
    return () => { active = false; };
  }, []);
  const updateSample = (index, field, value) => setSamples((current) => current.map((sample, itemIndex) => itemIndex === index ? { ...sample, [field]: value } : sample));
  const extract = async (index) => {
    const url = samples[index].url.trim();
    if (!url) return updateSample(index, "error", "请先粘贴公众号文章链接");
    updateSample(index, "loading", true); updateSample(index, "error", "");
    try { const response = await fetch("/api/articles/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setSamples((current) => current.map((sample, itemIndex) => itemIndex === index ? { ...sample, ...result, loading: false } : sample)); }
    catch (error) { setSamples((current) => current.map((sample, itemIndex) => itemIndex === index ? { ...sample, loading: false, error: error.message } : sample)); }
  };
  const analyze = async () => {
    setAnalyzing(true);
    try { const response = await fetch("/api/dna/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ articles: samples }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setDna(result); notify("文风 DNA 已生成并保存在本地工作区"); }
    catch (error) { notify(`暂时无法生成：${error.message}`); } finally { setAnalyzing(false); }
  };
  const beginReanalysis = async () => {
    try {
      const response = await fetch("/api/dna/samples");
      const result = await response.json();
      if (response.ok && result.samples?.length) setSamples(result.samples.map((sample) => ({ ...sample, error: "", loading: false })));
    } catch {}
    setDna(null);
  };
  const referenceArticles = dna?.sourceArticles?.length ? dna.sourceArticles : (dna?.articles || []).map((title, index) => ({ id: `legacy-${index}`, title, url: "", publishedAt: "" }));
  const publishedLabel = (value) => value ? new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
  return <section className="page dna-page">
    <Topbar title="文风 DNA" subtitle="同时学习表达、结构、版式和媒体习惯" status={false} action={dna && <button className="primary" onClick={beginReanalysis}>重新分析样本</button>} />
    {dna ? <>
      {dna.version !== 2 && <div className="dna-upgrade"><Sparkle size={21} /><div><b>当前是旧版表达 DNA</b><p>它只保存了摘要和写作规则。重新分析后会保留原文片段、结构习惯和图片位置，写作时才能真正带入。</p></div><button className="secondary" onClick={beginReanalysis}>升级 DNA</button></div>}
      <div className="dna-grid">
        <section>
          <div className="dna-meta"><span>已分析 {dna.articles?.length || 0} 篇真实样本 · {new Date(dna.updatedAt).toLocaleDateString("zh-CN")}</span>{dna.sourceStats && <small>{dna.sourceStats.paragraphCount} 个段落 · {dna.sourceStats.imageCount} 个媒体节点</small>}</div>
          <h2>表达指纹</h2>
          <p className="dna-summary">{dna.summary}</p>
          <div className="dna-rules">{(dna.rules || []).map((rule, index) => <div className="dna-rule" key={rule.label}><Fingerprint size={28} weight="regular" /><div><h3>{rule.label}</h3><p>{rule.text}</p></div><span>{String(index + 1).padStart(2, "0")}</span></div>)}</div>
          {dna.structureProfiles?.length > 0 && <section className="structure-dna"><div className="dna-section-title"><span>结构 DNA</span><p>写新文章时会按内容选择，不会固定套用。</p></div>{dna.structureProfiles.map((profile) => <article key={profile.name}><div><h3>{profile.name}</h3><span>{profile.fit}</span></div><p>{profile.flow}</p><small>{profile.sectioning}</small></article>)}</section>}
          {dna.voiceExamples?.length > 0 && <section className="voice-examples"><div className="dna-section-title"><span>原文表达片段</span><p>全文写作会按选题检索相关片段，只学习节奏，不复制事实。</p></div>{dna.voiceExamples.slice(0, 6).map((item, index) => <blockquote key={`${item.role}-${index}`}><small>{item.role}</small><p>{item.excerpt}</p><footer>{item.lesson}</footer></blockquote>)}</section>}
        </section>
        <aside className="reference-articles">
          {dna.layoutHabits && <section className="dna-side-section"><h2>版式节奏</h2><dl><div><dt>自然段</dt><dd>{dna.layoutHabits.paragraphRhythm}</dd></div><div><dt>分节习惯</dt><dd>{dna.layoutHabits.sectioning}</dd></div><div><dt>重点表达</dt><dd>{dna.layoutHabits.emphasis}</dd></div></dl></section>}
          {dna.mediaHabits && <section className="dna-side-section"><h2>媒体习惯</h2><dl><div><dt>图片</dt><dd>{dna.mediaHabits.images}</dd></div><div><dt>表情包</dt><dd>{dna.mediaHabits.memes}</dd></div><div><dt>放置位置</dt><dd>{dna.mediaHabits.placement}</dd></div></dl></section>}
          <h2>参考文章</h2>{referenceArticles.map((article, index) => <div className="reference-row" key={article.id || article.url || `${article.title}-${index}`}><FileText size={23} />{article.url ? <a href={article.url} target="_blank" rel="noreferrer" title="在浏览器中打开原文">{article.title || "未命名文章"}</a> : <span>{article.title || "未命名文章"}</span>}{article.publishedAt && <time dateTime={article.publishedAt}>{publishedLabel(article.publishedAt)}</time>}</div>)}
        </aside>
      </div>
    </> : <section className="dna-onboarding"><div><span>DNA 2.0</span><h2>把你满意的公众号文章链接交给稿间</h2><p>粘贴 3～10 个链接。稿间会保留正文段落、图片与 GIF 的原始位置，再提炼表达、结构、版式和媒体习惯。只有某篇无法读取时，才需要粘贴正文兜底。</p></div><div className="sample-list">{samples.map((sample, index) => <article className="sample-input" key={index}><small>样本 {index + 1}</small><div className="link-entry"><input value={sample.url} onChange={(event) => updateSample(index, "url", event.target.value)} placeholder="粘贴 mp.weixin.qq.com 文章链接" /><button className="secondary" disabled={sample.loading} onClick={() => extract(index)}>{sample.loading ? "读取中…" : "读取链接"}</button></div>{sample.content ? <p className="extract-success"><Check size={17} />已读取「{sample.title}」· {sample.content.length} 字{sample.structure ? ` · ${sample.structure.paragraphCount} 段 · ${sample.structure.imageCount + sample.structure.gifCount} 个媒体节点` : ""}</p> : sample.error ? <div className="extract-fallback"><p>{sample.error}</p><textarea value={sample.content} onChange={(event) => updateSample(index, "content", event.target.value)} placeholder="仅在链接读取失败时，粘贴该篇正文兜底" /></div> : null}</article>)}</div><div className="dna-actions">{samples.length < 10 && <button className="secondary" onClick={() => setSamples((current) => [...current, { url: "", title: "", content: "", error: "" }])}><Plus size={18} /> 再加一篇</button>}<button className="primary" disabled={analyzing} onClick={analyze}>{analyzing ? "正在分析表达与结构…" : "生成文风 DNA 2.0"}</button></div></section>}
  </section>;
}

function LibraryPage({ search, setSearch, filter, setFilter, articles: visibleArticles, total, loading, notify, reload, onEdit, onPreview, onNew }) {
  const filters = ["全部", "草稿", "已排版", "已发布"];
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const formatDate = (value) => {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "刚刚";
  };
  const importArticle = async () => {
    if (!importUrl.trim()) return setImportError("请先粘贴一篇公众号文章链接");
    setImporting(true); setImportError("");
    try {
      const extractResponse = await fetch("/api/articles/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: importUrl.trim() }) });
      const extracted = await extractResponse.json();
      if (!extractResponse.ok) throw new Error(extracted.error || "读取失败");
      const markdown = `# ${extracted.title}\n\n${extracted.content.split(/\n+/).filter(Boolean).join("\n\n")}`;
      const saveResponse = await fetch("/api/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: extracted.title, markdown, status: "草稿", source: "公众号导入" }) });
      const saved = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saved.error || "保存失败");
      await reload();
      setImportUrl(""); setImportOpen(false);
      notify("文章已读取并保存到文章库");
    } catch (error) { setImportError(error.message); }
    finally { setImporting(false); }
  };
  const deleteOne = async (article) => {
    try {
      const response = await fetch(`/api/library/${article.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "删除失败");
      setDeletingId(null); await reload(); notify("文章已删除");
    } catch (error) { notify(`删除失败：${error.message}`); }
  };
  return <section className="page library-page">
    <Topbar title="文章" subtitle="每次生成和修改都会留在这里，随时可以接着写" status={false} action={<><button className="secondary" onClick={() => { setImportOpen((open) => !open); setImportError(""); }}><LinkSimple size={18} />导入公众号文章</button><button className="primary" onClick={onNew}><Plus size={18} />新建文章</button></>} />
    {importOpen && <section className="library-import">
      <div><span><LinkSimple size={21} /></span><div><h2>从公众号链接导入</h2><p>读取成功后会作为草稿保存，不会触发 AI 写作。</p></div></div>
      <div className="library-import-form"><input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://mp.weixin.qq.com/s/..." onKeyDown={(event) => { if (event.key === "Enter") importArticle(); }} /><button className="primary" disabled={importing} onClick={importArticle}>{importing ? "正在读取…" : "读取并保存"}</button><button className="icon-close" aria-label="关闭导入" onClick={() => setImportOpen(false)}><X size={19} /></button></div>
      {importError && <p className="inline-error">{importError}</p>}
    </section>}
    <div className="library-tools"><label className="search"><MagnifyingGlass size={22} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、关键词或来源" /></label><div className="filters">{filters.map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div></div>
    {loading ? <div className="library-empty compact"><ClockCounterClockwise size={27} /><h2>正在读取文章库</h2></div> : visibleArticles.length ? <div className="article-table">
      <div className="article-head"><span>文章</span><span>来源</span><span>状态</span><span>更新时间</span><span>操作</span></div>
      {visibleArticles.map((article) => <article className="article-row" key={article.id}>
        <div className="article-main"><h2>{article.title || "未命名文章"}</h2><p>{article.excerpt || "还没有正文摘要"}</p></div>
        <span>{article.source || "本地草稿"}</span>
        <b className={`tag status-${article.status}`}>{article.status || "草稿"}</b>
        <time>{formatDate(article.updatedAt)}</time>
        <div className="article-actions">
          <button title="继续编辑" aria-label={`继续编辑${article.title}`} onClick={() => onEdit(article)}><PencilSimple size={18} /></button>
          <button title="进入排版" aria-label={`排版${article.title}`} onClick={() => onPreview(article)}><ClipboardText size={18} /></button>
          <button className="danger" title="删除" aria-label={`删除${article.title}`} onClick={() => setDeletingId(article.id)}><TrashSimple size={18} /></button>
        </div>
        {deletingId === article.id && <div className="delete-confirm"><span>删除后无法从文章库恢复，确定删除？</span><button onClick={() => setDeletingId(null)}>取消</button><button className="danger-text" onClick={() => deleteOne(article)}>确认删除</button></div>}
      </article>)}
    </div> : <div className="library-empty"><BookOpen size={34} /><h2>{total ? "没有符合条件的文章" : "文章库还是空的"}</h2><p>{total ? "换个关键词或状态看看。" : "从写作台生成的全文会自动保存到这里，也可以导入已有公众号文章。"}</p>{!total && <button className="primary" onClick={onNew}><Plus size={18} />写第一篇文章</button>}</div>}
    <p className="count">{search || filter !== "全部" ? `找到 ${visibleArticles.length} 篇` : `共 ${total} 篇文章`}</p>
  </section>;
}

function PreviewPage({ article, theme, setTheme, showToc, setShowToc, showSignature, setShowSignature, notify, onSaved, onBack, onOpenSkills, agentStatus }) {
  const [layoutHtml, setLayoutHtml] = useState(article?.layoutHtml || "");
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [previewMode, setPreviewMode] = useState("wide");
  const [openPanel, setOpenPanel] = useState("article");
  const [articleSettings, setArticleSettings] = useState({
    author: article?.articleSettings?.author || "",
    authorBio: article?.articleSettings?.authorBio || "",
    digest: article?.articleSettings?.digest || "",
  });
  const [coverUrl, setCoverUrl] = useState("");
  const [coverFit, setCoverFit] = useState("cover");
  const [coverCandidates, setCoverCandidates] = useState([]);
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [bodyStyle, setBodyStyle] = useState(article?.articleSettings?.bodyStyle || { fontSize: 15, lineHeight: 1.9, paragraphGap: 16 });
  const autoLayoutStarted = useRef(false);
  const title = article?.title || "尚未生成文章";
  const markdown = article?.markdown || "";
  const contentText = `${title}\n${markdown}`;
  const recommended = contentText.match(/教程|步骤|清单|工具/) ? themes[0] : contentText.match(/复盘|案例|手记/) ? themes[5] : contentText.match(/设计|科技|AI|专业/) ? themes[2] : contentText.match(/随笔|生活|思考/) ? themes[3] : themes[1];
  const blocks = markdown.split(/\n+/).filter(Boolean).filter((line) => !line.startsWith("# "));
  const applyTheme = async (selectedTheme = theme) => {
    setLayoutLoading(true); setLayoutError("");
    try {
      const response = await fetch("/api/writing/layout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          markdown,
          theme: selectedTheme[0],
          showToc,
          showSignature,
          author: articleSettings.author,
          authorBio: articleSettings.authorBio,
          digest: articleSettings.digest,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "排版失败");
      setLayoutHtml(result.html);
      if (article?.id) {
        const saveResponse = await fetch(`/api/library/${article.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...article,
            status: "已排版",
            theme: selectedTheme[0],
            layoutHtml: result.html,
            articleSettings: { ...articleSettings, showSignature, bodyStyle },
          }),
        });
        if (!saveResponse.ok) throw new Error("排版已完成，但文章状态保存失败");
        onSaved?.();
      }
      notify(`${selectedTheme[0]}已应用，公众号兼容校验通过`);
    }
    catch (error) { setLayoutError(error.message); } finally { setLayoutLoading(false); }
  };
  useEffect(() => {
    if (!article || autoLayoutStarted.current) return;
    autoLayoutStarted.current = true;
    if (typeof article.articleSettings?.showSignature === "boolean") setShowSignature(article.articleSettings.showSignature);
    setTheme(recommended);
    if (article.previewOnly || article.layoutHtml) return;
    applyTheme(recommended);
  }, [article]);
  const sanitizeSignatureTemplate = (html) => {
    if (!html || !html.includes("{{")) return html;
    const documentValue = new DOMParser().parseFromString(html, "text/html");
    documentValue.body.querySelectorAll("*").forEach((element) => {
      const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
      if (element.children.length === 0 && (/^\s*我是\s*\{\{作者名\}\}\s*[，,]\s*\{\{简介\}\}\s*$/.test(text) || /\{\{作者名\}\}|\{\{简介\}\}/.test(text))) element.remove();
    });
    return documentValue.body.innerHTML;
  };
  const applyBodyStyleToHtml = (html) => {
    const documentValue = new DOMParser().parseFromString(sanitizeSignatureTemplate(html), "text/html");
    documentValue.body.querySelectorAll("p").forEach((paragraph) => {
      paragraph.style.fontSize = `${bodyStyle.fontSize}px`;
      paragraph.style.lineHeight = String(bodyStyle.lineHeight);
      paragraph.style.marginBottom = `${bodyStyle.paragraphGap}px`;
    });
    return documentValue.body.innerHTML;
  };
  const copyRichText = async () => {
    if (!layoutHtml) return notify("请先应用一套 GZH Design 主题");
    const exportHtml = applyBodyStyleToHtml(layoutHtml);
    try { await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([exportHtml], { type: "text/html" }), "text/plain": new Blob([markdown], { type: "text/plain" }) })]); notify("已复制公众号富文本"); }
    catch { notify("浏览器未允许富文本复制，请重试"); }
  };
  const updateArticleSetting = (key, value) => {
    setArticleSettings((current) => ({ ...current, [key]: value }));
    setLayoutHtml("");
    setLayoutError("");
  };
  const generateCovers = async () => {
    setCoverGenerating(true); setCoverError("");
    try {
      const response = await fetch("/api/writing/cover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId: article?.id, title, markdown, count: 2 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "封面生成失败");
      setCoverCandidates(result.covers || []);
      setCoverUrl(result.covers?.[0]?.url || "");
      notify(`已生成 ${result.covers?.length || 0} 个封面方案`);
    } catch (error) { setCoverError(error.message); }
    finally { setCoverGenerating(false); }
  };
  const panelButton = (key, icon, label, hint) => <button className={`inspector-row ${openPanel === key ? "open" : ""}`} onClick={() => setOpenPanel(openPanel === key ? "" : key)}>
    <span>{icon}</span><span><b>{label}</b><small>{hint}</small></span>{openPanel === key ? <CaretDown size={17} /> : <CaretRight size={17} />}
  </button>;
  const previewStyle = {
    "--accent": theme[1],
    "--tint": theme[2],
    "--body-size": `${bodyStyle.fontSize}px`,
    "--body-leading": bodyStyle.lineHeight,
    "--paragraph-gap": `${bodyStyle.paragraphGap}px`,
  };
  const layoutReady = Boolean(layoutHtml || article?.previewOnly);
  const coverSkillReady = Boolean(agentStatus?.skills?.baoyuCover);
  return <section className="page preview-page">
    <header className="preview-header">
      <div className="preview-title"><div><h1>排版预览</h1><p>检查文章效果，调整细节后复制到公众号</p></div></div>
      <div className="topbar-actions"><button className="secondary back-with-icon" onClick={onBack}><ArrowLeft size={17} />返回文章</button><button className="primary" disabled={!layoutReady} onClick={copyRichText}><Copy size={19} />复制到公众号</button></div>
    </header>
    <div className="preview-layout">
      <aside className="preview-controls">
        <div className="current-article"><small>当前文章</small><h2>{title}</h2></div>
        <div className="theme-list"><div className="theme-heading"><small>选择主题</small><span>{recommended[0]}推荐</span></div>{themes.map((item) => <button key={item[0]} className={theme[0] === item[0] ? "selected" : ""} onClick={() => { setTheme(item); setLayoutHtml(""); setLayoutError(""); }}><i style={{ background: item[1] }} />{item[0]}{item[0] === recommended[0] && <em>推荐</em>}{theme[0] === item[0] && <Check size={18} weight="bold" />}</button>)}</div>
        <button className="primary full apply-theme" disabled={layoutLoading} onClick={() => applyTheme(theme)}>{layoutLoading ? "正在应用排版…" : `应用「${theme[0]}」`}</button>
        {layoutError && <p className="layout-error">{layoutError}</p>}
        <div className="quick-toggles"><Toggle label="显示目录" checked={showToc} setChecked={(value) => { setShowToc(value); setLayoutHtml(""); }} /></div>
      </aside>
      <section className={`preview-canvas ${previewMode}`}>
        <div className="preview-toolbar">
          <div className="segmented"><button className={previewMode === "mobile" ? "active" : ""} onClick={() => setPreviewMode("mobile")}>手机</button><button className={previewMode === "wide" ? "active" : ""} onClick={() => setPreviewMode("wide")}>宽屏</button></div>
          <span className={layoutError ? "error" : ""}>{layoutLoading ? <><Sparkle size={18} />正在应用 GZH Design</> : layoutReady ? <>排版已应用</> : <>主题或文章设置有修改</>}</span>
        </div>
        <div className={`preview-paper ${layoutLoading ? "is-loading" : ""}`} style={previewStyle}>
          {coverUrl && <img className="article-cover" src={coverUrl} alt="文章封面" style={{ objectFit: coverFit }} />}
          {layoutLoading ? <div className="layout-loading"><Sparkle size={24} />正在生成公众号排版…</div> : layoutHtml ? <article className="article-preview gzh-rendered" dangerouslySetInnerHTML={{ __html: sanitizeSignatureTemplate(layoutHtml) }} /> : <article className="article-preview"><h1>{title}</h1>{articleSettings.author && <p className="article-info">{articleSettings.author}</p>}{articleSettings.digest && <blockquote>{articleSettings.digest}</blockquote>}{showToc && <div className="toc">{blocks.filter((line) => line.startsWith("## ")).slice(0, 3).map((line) => line.replace(/^## /, "")).join(" · ")}</div>}{blocks.map((line, index) => line.startsWith("## ") ? <h2 key={index}><b>{String(blocks.slice(0, index + 1).filter((item) => item.startsWith("## ")).length).padStart(2, "0")}</b>{line.replace(/^## /, "")}</h2> : line.startsWith("> ") ? <blockquote key={index}>{line.replace(/^> /, "")}</blockquote> : <p key={index}>{line.replace(/^[-*]\s/, "")}</p>)}{showSignature && (articleSettings.author || articleSettings.authorBio) && <footer>我是 <strong>{articleSettings.author || "作者"}</strong>{articleSettings.authorBio ? `，${articleSettings.authorBio}` : ""}</footer>}</article>}
        </div>
      </section>
      <aside className="preview-inspector">
        <div className="inspector-sections">
          {panelButton("article", <FileText size={20} />, "文章设置", articleSettings.author || "尚未填写作者")}
          {openPanel === "article" && <div className="inspector-panel">
            <label>作者名称<input value={articleSettings.author} onChange={(event) => updateArticleSetting("author", event.target.value)} placeholder="例如：稿间编辑部" /></label>
            <label>作者简介<input value={articleSettings.authorBio} onChange={(event) => updateArticleSetting("authorBio", event.target.value)} placeholder="例如：持续记录工具、创作与真实经验" /></label>
            <label>文章摘要<textarea value={articleSettings.digest} onChange={(event) => updateArticleSetting("digest", event.target.value)} placeholder="用于主题中的引言或摘要组件" /></label>
            <Toggle label="显示作者签名" checked={showSignature} setChecked={(value) => { setShowSignature(value); setLayoutHtml(""); }} />
            {showSignature && !(articleSettings.author || articleSettings.authorBio) && <small className="setting-hint">填写作者或简介后才会生成签名，不会保留空模板。</small>}
          </div>}
          {panelButton("cover", <ImageSquare size={20} />, "封面选择", coverUrl ? "已选择一个方案" : "可选 · 根据本文生成")}
          {openPanel === "cover" && <div className="inspector-panel cover-generator">
            <p>生成 2 个适合本文的公众号封面，选中后可单独下载，再到公众号后台上传。</p>
            {!coverSkillReady ? <button className="secondary full" onClick={onOpenSkills}><DownloadSimple size={17} />先安装 baoyu-skills</button> : <button className="primary full" disabled={coverGenerating} onClick={generateCovers}><Sparkle size={17} />{coverGenerating ? "正在生成封面…" : "生成 2 个封面方案"}</button>}
            {coverError && <p className="layout-error">{coverError}</p>}
            {coverCandidates.length > 0 && <div className="cover-candidates">{coverCandidates.map((candidate, index) => <button className={coverUrl === candidate.url ? "selected" : ""} onClick={() => setCoverUrl(candidate.url)} key={candidate.url}><img src={candidate.url} alt={`封面方案 ${index + 1}`} /><span>方案 {index + 1}{coverUrl === candidate.url && <Check size={14} weight="bold" />}</span></button>)}</div>}
            {coverUrl && <><label>预览裁切<select value={coverFit} onChange={(event) => setCoverFit(event.target.value)}><option value="cover">填满画面</option><option value="contain">完整显示</option></select></label><a className="cover-download" href={coverUrl} download={`${title}-封面.png`}><DownloadSimple size={16} />下载当前封面</a></>}
          </div>}
          {panelButton("body", <NotePencil size={20} />, "正文样式", `${bodyStyle.fontSize}px · ${bodyStyle.lineHeight} 倍行距`)}
          {openPanel === "body" && <div className="inspector-panel range-panel"><label>字号 <span>{bodyStyle.fontSize}px</span><input type="range" min="13" max="18" value={bodyStyle.fontSize} onChange={(event) => setBodyStyle({ ...bodyStyle, fontSize: Number(event.target.value) })} /></label><label>行距 <span>{bodyStyle.lineHeight}</span><input type="range" min="1.5" max="2.2" step=".1" value={bodyStyle.lineHeight} onChange={(event) => setBodyStyle({ ...bodyStyle, lineHeight: Number(event.target.value) })} /></label><label>段间距 <span>{bodyStyle.paragraphGap}px</span><input type="range" min="10" max="28" value={bodyStyle.paragraphGap} onChange={(event) => setBodyStyle({ ...bodyStyle, paragraphGap: Number(event.target.value) })} /></label></div>}
        </div>
      </aside>
    </div>
  </section>;
}

function SkillsPage({ installed, setInstalled, notify, agentStatus, refreshAgentStatus }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("recommended");
  const [query, setQuery] = useState("");
  const [visibleSkillCount, setVisibleSkillCount] = useState(12);
  const [repoUrl, setRepoUrl] = useState("");
  const [installingTarget, setInstallingTarget] = useState("");
  const installRef = useRef(null);
  const recommendedSkills = [
    {
      id: "gzh-design",
      name: "GZH Design",
      description: "公众号文章排版与主题设计",
      fit: "进入排版预览后自动调用，为正文应用所选主题。",
      tags: ["排版", "自动接入"],
      repo: "https://github.com/isjiamu/gzh-design-skill",
      icon: ClipboardText,
      installed: installed || skills.some((skill) => /gzh-design/i.test(`${skill.id} ${skill.name}`)),
    },
    {
      id: "humanizer-zh",
      name: "Humanizer-zh",
      description: "减少中文内容的 AI 痕迹，让表达更自然",
      fit: "生成完整初稿时，在同一次 Agent 任务中完成中文润色。",
      tags: ["润色", "自动接入"],
      repo: "https://github.com/op7418/Humanizer-zh",
      icon: Feather,
      installed: skills.some((skill) => /humanizer-zh/i.test(`${skill.id} ${skill.name}`)),
    },
    {
      id: "baoyu-skills",
      name: "baoyu-skills",
      description: "生成公众号封面与文章视觉素材",
      fit: "点击生成封面时，按需调用其中的 baoyu-cover-image。",
      tags: ["封面", "按需接入"],
      repo: "https://github.com/JimLiu/baoyu-skills",
      icon: PaintBrushBroad,
      installed: skills.some((skill) => /baoyu-(cover-image|image-gen|article-illustrator)/i.test(`${skill.id} ${skill.name}`)),
    },
  ];
  const loadSkills = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/skills");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取失败");
      setSkills(result.skills || []);
    } catch { setSkills([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadSkills(); }, []);
  const installFromGithub = async (recommendedRepo = "", target = "manual") => {
    const targetRepo = String(recommendedRepo || repoUrl).trim();
    if (!targetRepo) return notify("先粘贴一个 GitHub Skill 仓库地址");
    setInstallingTarget(target);
    try {
      const response = await fetch("/api/skills/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repoUrl: targetRepo }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "安装失败");
      await Promise.all([loadSkills(), refreshAgentStatus()]);
      if (/gzh-design-skill/i.test(targetRepo)) setInstalled(true);
      setRepoUrl("");
      notify(result.alreadyInstalled ? "这个 Skill 已经安装" : result.installedIds?.length > 1 ? `已安装 ${result.installedIds.length} 个 Skill` : "Skill 已安装，可以在本地 Agent 中使用");
    } catch (error) { notify(`安装未完成：${error.message}`); }
    finally { setInstallingTarget(""); }
  };
  const skillUse = (skill) => {
    const value = `${skill.id} ${skill.name}`.toLowerCase();
    if (value.includes("gzh-design")) return "公众号文章排版、主题和样式生成";
    if (value.includes("doc")) return "读取、创建和编辑 Word 文档";
    if (value.includes("hatch-pet")) return "生成轻量角色与视觉素材";
    if (value.includes("humanizer")) return "优化中文表达，减少 AI 痕迹";
    if (value.includes("cover")) return "生成文章封面与视觉方案";
    if (value.includes("article-illustrator")) return "为长文规划和生成配图";
    return "已安装到本机，稿间暂未自动调用";
  };
  const shownSkills = skills.filter((skill) => {
    const matchesQuery = `${skill.name} ${skill.description} ${skill.id}`.toLowerCase().includes(query.toLowerCase());
    if (!matchesQuery) return false;
    if (category === "visual") return /image|cover|illustr|design|pet/i.test(`${skill.id} ${skill.name}`);
    if (category === "writing") return /human|write|doc|markdown|gzh/i.test(`${skill.id} ${skill.name}`);
    return true;
  });
  useEffect(() => { setVisibleSkillCount(12); }, [category, query, skills.length]);
  const visibleSkills = shownSkills.slice(0, visibleSkillCount);
  const hiddenSkillCount = Math.max(0, shownSkills.length - visibleSkills.length);
  const runtimeModel = agentStatus?.claude?.runtime?.model;
  return <section className="page skills-page">
    <Topbar title="技能库" subtitle="找到适合写作流程的能力，并交给本地 Agent 使用" status={false} />
    <div className="skill-agent-strip">
      <span><CodexIcon size={18} /><b>Codex CLI</b><i className={agentStatus?.codex?.loggedIn ? "ok" : ""} />{agentStatus?.codex?.loggedIn ? "可用" : agentStatus?.codex?.installed ? "等待登录" : "未安装"}</span>
      <span><ClaudeCodeIcon size={18} /><b>Claude Code</b><i className={agentStatus?.claude?.authenticated ? "ok" : ""} />{agentStatus?.claude?.authenticated ? runtimeModel || "可用 · 模型由本机配置" : agentStatus?.claude?.installed ? "等待认证" : "未安装"}</span>
      <button onClick={async () => { await refreshAgentStatus(); notify("本地 Agent 状态已更新"); }}><ArrowsClockwise size={15} />重新检测</button>
    </div>
    <div className="skill-library-layout">
      <aside className="skill-library-nav">
        <label className="skill-search"><MagnifyingGlass size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Skill" /></label>
        <h2>浏览</h2>
        {[
          ["recommended", "编辑推荐", 3],
          ["writing", "写作与润色", skills.filter((skill) => /human|write|doc|markdown|gzh/i.test(`${skill.id} ${skill.name}`)).length],
          ["visual", "排版与视觉", skills.filter((skill) => /image|cover|illustr|design|pet/i.test(`${skill.id} ${skill.name}`)).length],
          ["installed", "已安装", skills.length],
        ].map(([key, label, count]) => <button className={category === key ? "active" : ""} onClick={() => setCategory(key)} key={key}><span>{label}</span><small>{count}</small></button>)}
        <div className="skill-address-install">
          <h2>从 GitHub 安装</h2>
          <div><input ref={installRef} value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="粘贴仓库地址" onKeyDown={(event) => { if (event.key === "Enter") installFromGithub(); }} /><button disabled={Boolean(installingTarget)} onClick={() => installFromGithub()}>{installingTarget === "manual" ? <CircleNotch className="spin" size={17} /> : "检查"}</button></div>
          <p>支持单个 Skill，也支持包含多个 Skill 的仓库。</p>
        </div>
      </aside>
      <main className="skill-directory">
        {category === "recommended" && <>
          <div className="skill-section-title"><div><h2>编辑推荐</h2><span>先从这 3 个开始</span></div><small>适合公众号写作流程</small></div>
          <div className="recommended-skill-list">
            {recommendedSkills.map((skill) => {
              const Icon = skill.icon;
              return <article className="recommended-skill" key={skill.id}>
                <span className="recommended-icon"><Icon size={23} /></span>
                <div className="recommended-copy"><h3>{skill.name}</h3><p>{skill.description}</p><div>{skill.tags.map((tag) => <small key={tag}>{tag}</small>)}</div></div>
                <p className="recommended-fit">{skill.fit}</p>
                {skill.installed ? <span className="skill-ready"><CheckCircle size={17} weight="fill" />已安装</span> : <button className="skill-install-action" disabled={Boolean(installingTarget)} onClick={() => installFromGithub(skill.repo, skill.id)}>{installingTarget === skill.id ? <><CircleNotch className="spin" size={17} />安装中</> : "安装"}</button>}
              </article>;
            })}
          </div>
        </>}
        <div className="skill-section-title more-directory-title"><div><h2>{category === "recommended" ? "更多技能" : category === "visual" ? "排版与视觉" : category === "writing" ? "写作与润色" : "已安装"}</h2><span>{loading ? "正在读取…" : `${shownSkills.length} 项`}</span></div></div>
        {loading ? <div className="skill-empty">正在读取本地 Skill…</div> : shownSkills.length ? <div className="skill-table">
          <div className="skill-table-head"><span>技能</span><span>用途</span><span>状态</span></div>
          {visibleSkills.map((skill) => <article key={skill.id}><span className="skill-table-name"><Package size={18} /><b>{skill.name}</b></span><p>{skillUse(skill)}</p><span className="skill-ready"><CheckCircle size={15} weight="fill" />已安装</span></article>)}
          {hiddenSkillCount > 0 && <div className="skill-load-more">
            <span>已显示 {visibleSkills.length} / {shownSkills.length}</span>
            <button type="button" onClick={() => setVisibleSkillCount((current) => current + 12)}>加载更多<CaretDown size={15} /></button>
          </div>}
        </div> : <div className="skill-empty">这个分类里暂时没有 Skill</div>}
      </main>
    </div>
  </section>;
}

function SettingsPage({ settings, setSettings, notify, agentStatus, refreshAgentStatus }) {
  const [tab, setTab] = useState("agent");
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [backups, setBackups] = useState([]);
  const [backingUp, setBackingUp] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState("");
  useEffect(() => { setForm(settings); }, [settings]);
  const loadBackups = async () => {
    try {
      const response = await fetch("/api/backups");
      const result = await response.json();
      if (response.ok) setBackups(result.backups || []);
    } catch {}
  };
  useEffect(() => { if (tab === "files") loadBackups(); }, [tab]);
  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      setSettings(result); setForm(result); notify("设置已保存");
    } catch (error) { notify(`保存失败：${error.message}`); }
    finally { setSaving(false); }
  };
  const backup = async () => {
    setBackingUp(true);
    try {
      const response = await fetch("/api/backups", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "备份失败");
      await loadBackups(); notify(`已备份 ${result.articleCount} 篇文章`);
    } catch (error) { notify(`备份失败：${error.message}`); }
    finally { setBackingUp(false); }
  };
  const removeBackup = async (filename) => {
    try {
      const response = await fetch(`/api/backups/${filename}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "删除失败");
      setDeletingBackup(""); await loadBackups(); notify("备份已删除");
    } catch (error) { notify(`删除失败：${error.message}`); }
  };
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  return <section className="page settings-page">
    <Topbar title="设置" subtitle="管理本地 Agent、写作偏好和文件位置" status={false} />
    <div className="settings-layout">
      <aside className="settings-nav">{[["agent", "本地 Agent"], ["writing", "写作偏好"], ["files", "文件与备份"], ["about", "关于稿间"]].map(([key, label]) => <button className={tab === key ? "active" : ""} key={key} onClick={() => setTab(key)}>{label}</button>)}</aside>
      <section className="settings-main">
        {tab === "agent" && <><div className="settings-section-head"><div><h2>本地 Agent</h2><p>稿间调用本机 CLI；模型、订阅或第三方路由由各 Agent 自己管理。</p></div><button className="secondary" onClick={async () => { await refreshAgentStatus(); notify("本地 Agent 状态已更新"); }}><ArrowsClockwise size={17} />重新检测</button></div><div className="current-agent-list">
          <div className="current-agent"><span className="agent-icon"><CodexIcon size={30} /></span><div><h3>Codex CLI {agentStatus?.codex?.loggedIn && <><i /> <em>可用</em></>}</h3><p>{agentStatus?.codex?.installed ? `${agentStatus.codex.version} · ${agentStatus.codex.loggedIn ? "ChatGPT 已登录" : "等待登录"}` : "尚未检测到 Codex CLI"}</p></div></div>
          <div className="current-agent"><span className="agent-icon"><ClaudeCodeIcon size={30} /></span><div><h3>Claude Code {agentStatus?.claude?.authenticated && <><i /> <em>可用</em></>}</h3><p>{agentStatus?.claude?.installed ? `${agentStatus.claude.version} · ${agentStatus.claude.runtime?.model ? `实际模型 ${agentStatus.claude.runtime.model}` : "模型路由会在首次任务后确认"}` : "尚未检测到 Claude Code"}</p>{agentStatus?.claude?.runtime?.route && <small>{agentStatus.claude.runtime.route} · 结构化流式输出已验证</small>}</div></div>
        </div><div className="runtime-scope"><ShieldCheck size={23} /><div><h2>运行范围</h2><p>写作任务在只读临时工作区中执行。Claude Code 的登录方式不一定等于实际模型路由，稿间会以任务运行事件为准显示模型。</p></div></div></>}
        {tab === "writing" && <><div className="settings-section-head"><div><h2>写作偏好</h2><p>这些配置会用于新的写作任务，不会改动已有文章。</p></div></div><div className="settings-form"><label>默认文风浓度<select value={form.styleStrength || "明显带入"} onChange={(event) => setField("styleStrength", event.target.value)}><option>轻度参考</option><option>明显带入</option><option>尽量还原</option></select></label></div><div className="permission-settings"><Toggle label="自动保存全文修改" checked={form.autosave} setChecked={(value) => setField("autosave", value)} /></div><div className="save-row"><button className="primary" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存写作偏好"}</button></div></>}
        {tab === "files" && <><div className="settings-section-head"><div><h2>文件与备份</h2><p>文章、设置和文风 DNA 都保存在本机 SQLite 数据库中。</p></div><button className="primary" disabled={backingUp} onClick={backup}><Database size={18} />{backingUp ? "正在备份…" : "立即备份"}</button></div><div className="settings-form"><label>数据位置<input value={form.workspacePath || ""} readOnly aria-readonly="true" /></label><label>保留备份数量<input type="number" min="3" max="100" value={form.backupRetention} onChange={(event) => setField("backupRetention", Number(event.target.value))} /></label></div><div className="save-row file-save"><button className="secondary" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存备份设置"}</button></div><section className="backup-history"><h2>最近备份</h2>{backups.length ? backups.slice(0, 8).map((item) => <article key={item.filename}><span><FolderOpen size={19} /></span><div><b>{new Date(item.createdAt).toLocaleString("zh-CN")}</b><small>{item.articleCount} 篇文章 · {item.filename}</small></div>{deletingBackup === item.filename ? <div className="backup-delete-confirm"><button onClick={() => setDeletingBackup("")}>取消</button><button className="danger-text" onClick={() => removeBackup(item.filename)}>确认删除</button></div> : <button className="backup-delete" title="删除备份" aria-label={`删除备份 ${new Date(item.createdAt).toLocaleString("zh-CN")}`} onClick={() => setDeletingBackup(item.filename)}><TrashSimple size={17} /></button>}</article>) : <p className="empty-note">还没有备份。点击“立即备份”创建第一份本地快照。</p>}</section></>}
        {tab === "about" && <div className="about-gaojian"><span className="about-mark">稿间</span><h2>让写作留下来，也让工具安静一点。</h2><p>稿间是一个本地优先的微信公众号写作工作台。文章、文风 DNA 和偏好保存在你的电脑中；AI 写作通过本机 Agent 完成。</p><dl><div><dt>当前版本</dt><dd>0.1.0 · 本地预览版</dd></div><div><dt>数据位置</dt><dd>{form.workspacePath || "稿间本地工作区"}</dd></div><div><dt>排版能力</dt><dd>GZH Design · 6 套主题</dd></div></dl></div>}
      </section>
    </div>
  </section>;
}

function Toggle({ label, checked, setChecked }) { return <button className="toggle-row" onClick={() => setChecked(!checked)}><span>{label}</span><i className={checked ? "on" : ""}><b /></i></button>; }

export { App };
