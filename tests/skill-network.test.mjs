import assert from "node:assert/strict";
import test from "node:test";
import {
  friendlyGitCloneError,
  gitCloneArgs,
  gitProxyArgs,
  normalizeProxyUrl,
  parseWindowsProxy,
} from "../server/skill-network.mjs";

test("normalizes Windows proxy formats for Git", () => {
  assert.equal(normalizeProxyUrl("127.0.0.1:7897"), "http://127.0.0.1:7897");
  assert.equal(
    normalizeProxyUrl("http=127.0.0.1:8080;https=127.0.0.1:7897"),
    "http://127.0.0.1:7897",
  );
  assert.equal(normalizeProxyUrl("invalid proxy value"), "");
});

test("reads an enabled Windows system proxy", () => {
  assert.equal(
    parseWindowsProxy(
      "ProxyEnable    REG_DWORD    0x1",
      "ProxyServer    REG_SZ    127.0.0.1:7897",
    ),
    "http://127.0.0.1:7897",
  );
  assert.equal(
    parseWindowsProxy(
      "ProxyEnable    REG_DWORD    0x0",
      "ProxyServer    REG_SZ    127.0.0.1:7897",
    ),
    "",
  );
});

test("passes the detected proxy only to the Git clone process", () => {
  assert.deepEqual(
    gitProxyArgs("http://127.0.0.1:7897"),
    [
      "-c",
      "http.proxy=http://127.0.0.1:7897",
      "-c",
      "https.proxy=http://127.0.0.1:7897",
    ],
  );
  assert.deepEqual(
    gitCloneArgs("https://github.com/example/skill", "C:\\temp\\skill", "http://127.0.0.1:7897"),
    [
      "-c",
      "http.proxy=http://127.0.0.1:7897",
      "-c",
      "https.proxy=http://127.0.0.1:7897",
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--no-checkout",
      "https://github.com/example/skill",
      "C:\\temp\\skill",
    ],
  );
});

test("turns raw Git connection failures into actionable Chinese copy", () => {
  assert.equal(
    friendlyGitCloneError("Failed to connect to github.com port 443: Could not connect to server", true),
    "通过系统代理连接 GitHub 仍然超时，请确认代理软件正在运行后重试",
  );
  assert.equal(
    friendlyGitCloneError("error: unable to read sha1 file of SKILL.md", true),
    "Skill 文件下载不完整，请重试",
  );
});
