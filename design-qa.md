# 技能库 Design QA

- Source visual truth: `D:\Code\Project\wechat-mp\audit\skills-library-reference.png`
- Implementation screenshot: `D:\Code\Project\wechat-mp\audit\skills-library-final-1280x720.png`
- Full-view comparison: `D:\Code\Project\wechat-mp\audit\skills-library-comparison.png`
- Focused comparison: `D:\Code\Project\wechat-mp\audit\skills-library-focused-comparison.png`
- Source pixels: 1487 × 1058
- Implementation pixels: 1265 × 712
- Browser CSS viewport: 1280 × 720 at DPR 1
- Normalization: both full views were scaled to 720 px high for the side-by-side comparison; the skill directory regions were separately cropped and normalized to 480 px high for typography, spacing, controls, and row-density review.
- State: 技能库 / 编辑推荐；Codex CLI 与 Claude Code 均可用；GZH Design 已安装；Humanizer-zh 与 baoyu-skills 未安装。

## Findings

No actionable P0, P1, or P2 differences remain.

- Typography: passed. The implementation keeps the restrained serif hierarchy, reduces the page title to 30 px, and uses compact 11–13 px UI copy. The three featured Skill rows are visibly smaller than the selected mock, matching the user's explicit adjustment.
- Spacing and layout rhythm: passed. Sidebar, agent strip, two-column directory, dividers, search, category rail, featured rows, and table align consistently. The 720 px viewport shows fewer lower table rows than the taller reference, but the page remains scrollable and no persistent controls are hidden.
- Colors and visual tokens: passed. Warm ivory, ink, soft gray rules, and jade-green states remain consistent with the existing 稿间 shell and the selected mock.
- Image and icon fidelity: passed. The page has no raster illustration requirements. Phosphor line icons are used consistently; there are no emoji, CSS drawings, handcrafted SVGs, or placeholder image assets.
- Copy and content: passed. Navigation labels are “文章” and “技能库”; the three recommended Skills and concise Chinese descriptions match the chosen information architecture. Long local English descriptions are not exposed.
- Interaction and accessibility: passed. Main navigation, Skill categories, Agent detection refresh, GitHub address field, recommended install actions, writer Agent selector, preview mobile/wide switch, article settings, signature toggle, and cover-entry state have usable semantic controls.

## Comparison History

1. Initial implementation comparison found one P2 density mismatch: the selected mock's recommended panels were still too prominent for the user's “改小一点” instruction.
   - Fix: implemented 88 px flat rows with smaller icons, 16 px names, 11 px descriptions, and light separators; removed large card framing.
   - Post-fix evidence: `audit\skills-library-focused-comparison.png` shows the implementation rows are materially lighter and shorter than the selected mock while preserving its two-column structure.
2. Browser regression found a P1 stale-content issue in old saved layouts: `我是 {{作者名}}，{{简介}}` could remain visible before the user reapplied a theme.
   - Fix: sanitize legacy placeholder nodes during preview and rich-text export; new GZH Design runs now receive real author/bio values or explicit instructions to omit the signature.
   - Post-fix evidence: browser text check returned `hasEmptyTemplate: false`; `分享卡片` and `是否原创` also returned false.

## Primary interactions tested

- Opened 技能库 from the persistent sidebar.
- Switched to “排版与视觉” and back to “编辑推荐”.
- Confirmed Claude Code appears in the writer Agent popover and can be selected.
- Ran a real Claude Code structured streaming task; detected `deepseek-v4-pro[1m]` from runtime events.
- Opened an article in 排版预览.
- Switched 手机 → 宽屏 and verified the canvas state changed.
- Verified 作者名称、作者简介、文章摘要、作者签名开关 and 封面选择 are present.
- Verified 分享卡片、是否原创 and empty author placeholders are absent.
- Checked browser console warning/error logs: none.

## Follow-up Polish

- P3: At 1280 × 720, the lower Skill table continues below the fold. This is expected for the shorter viewport and remains usable with the page scrollbar.
- P3: baoyu-skills cover rendering cannot be end-to-end image-tested until that optional Skill and one supported raster backend are installed. The missing-dependency state was tested and correctly routes the user to 技能库.

final result: passed
