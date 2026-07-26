export function normalizeProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const entries = raw.split(";").map((entry) => entry.trim()).filter(Boolean);
  const keyed = new Map(entries.map((entry) => {
    const separator = entry.indexOf("=");
    return separator > 0
      ? [entry.slice(0, separator).toLowerCase(), entry.slice(separator + 1).trim()]
      : ["", entry];
  }));
  const candidate = keyed.get("https") || keyed.get("http") || keyed.get("") || "";
  if (!candidate) return "";

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
    ? candidate
    : `http://${candidate}`;
  try {
    const parsed = new URL(withProtocol);
    return ["http:", "https:", "socks:", "socks5:"].includes(parsed.protocol)
      ? parsed.toString().replace(/\/$/, "")
      : "";
  } catch {
    return "";
  }
}

export function parseWindowsProxy(enableOutput, serverOutput) {
  if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(String(enableOutput || ""))) return "";
  const server = String(serverOutput || "").match(/ProxyServer\s+REG_SZ\s+(.+)/i)?.[1]?.trim();
  return normalizeProxyUrl(server);
}

export function gitProxyArgs(proxy = "") {
  const args = [];
  if (proxy) args.push("-c", `http.proxy=${proxy}`, "-c", `https.proxy=${proxy}`);
  return args;
}

export function gitCloneArgs(repoUrl, checkout, proxy = "") {
  return [
    ...gitProxyArgs(proxy),
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--no-checkout",
    repoUrl,
    checkout,
  ];
}

export function friendlyGitCloneError(error, usedProxy = false) {
  const detail = String(error || "");
  if (/not recognized|ENOENT|not found/i.test(detail)) {
    return "没有检测到 Git，请先安装 Git 后再重试";
  }
  if (/Could not resolve host|unable to resolve/i.test(detail)) {
    return "无法解析 GitHub 地址，请检查网络或 DNS 后重试";
  }
  if (/Failed to connect|Could not connect|timed out/i.test(detail)) {
    return usedProxy
      ? "通过系统代理连接 GitHub 仍然超时，请确认代理软件正在运行后重试"
      : "连接 GitHub 超时，请开启可访问 GitHub 的系统代理后重试";
  }
  if (/SSL certificate|certificate problem/i.test(detail)) {
    return "GitHub 安全连接校验失败，请检查系统时间、证书或代理设置";
  }
  if (/Authentication failed|Permission denied|Repository not found/i.test(detail)) {
    return "无法访问这个仓库，请确认地址正确且仓库允许公开访问";
  }
  if (/unable to read sha1|promisor remote|could not fetch/i.test(detail)) {
    return "Skill 文件下载不完整，请重试";
  }
  return "无法完成 Skill 下载，请稍后重试";
}
