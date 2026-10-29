import React from "react";
import type { CanvasPreferences } from "./canvas-preferences";

type Props = { value: CanvasPreferences; onChange: (patch: Partial<CanvasPreferences>) => void; children?: React.ReactNode };
type Tab = "interaction" | "notifications" | "connections" | "grid" | "appearance" | "account";

const tabs: Array<[Tab, string]> = [
  ["interaction", "交互操作"], ["notifications", "任务提示"], ["connections", "连线设置"],
  ["grid", "网格与布局"], ["appearance", "画布外观"], ["account", "账户与保存"],
];

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="canvas-setting-switch"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><i aria-hidden="true" /></label>;
}
function Choices<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void;
}) {
  return <div className="canvas-setting-row"><span>{label}</span><div role="group" aria-label={label}>
    {options.map(([id, text]) => <button key={id} type="button" className={`canvas-setting-choice${value === id ? " is-selected" : ""}`} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}
  </div></div>;
}
function Range({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="canvas-setting-range"><span>{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /><output>{value}{suffix || ""}</output></label>;
}

export default function CanvasSettingsPanel({ value, onChange, children }: Props) {
  const [tab, setTab] = React.useState<Tab>("interaction");
  const body = React.useRef<HTMLDivElement>(null);
  const sections = React.useRef<Partial<Record<Tab, HTMLElement | null>>>({});
  const visibleTabs = children ? tabs : tabs.filter(([id]) => id !== "account");
  const goToSection = (id: Tab) => {
    const panel = body.current;
    const section = sections.current[id];
    if (!panel || !section) return;
    panel.scrollTo({ top: panel.scrollTop + section.getBoundingClientRect().top - panel.getBoundingClientRect().top });
    setTab(id);
  };
  const updateActiveSection = () => {
    const panel = body.current;
    if (!panel) return;
    const top = panel.getBoundingClientRect().top;
    let active: Tab = "interaction";
    for (const [id] of visibleTabs) {
      if ((sections.current[id]?.getBoundingClientRect().top ?? Infinity) <= top + 24) active = id;
    }
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2) active = visibleTabs[visibleTabs.length - 1][0];
    setTab(active);
  };
  return <div className="canvas-settings-shell">
    <div className="canvas-settings-layout">
      <nav className="canvas-settings-tabs" aria-label="画布设置分类">
        {visibleTabs.map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? "location" : undefined} aria-controls={`canvas-settings-${id}`} className={`canvas-settings-tab${tab === id ? " is-active" : ""}`} onClick={() => goToSection(id)}>{label}</button>)}
      </nav>
      <div className="canvas-settings-body" ref={body} onScroll={updateActiveSection}>
        <section id="canvas-settings-interaction" ref={el => { sections.current.interaction = el; }} className="canvas-settings-section">
          <h3>交互操作</h3>
          <Range label="画布平移灵敏度" value={value.panSensitivity} min={0.5} max={2.5} step={0.1} suffix="x" onChange={panSensitivity => onChange({ panSensitivity })} />
          <Range label="定位动画节点上限" value={value.locateAnimationLimit} min={0} max={300} step={10} onChange={locateAnimationLimit => onChange({ locateAnimationLimit })} />
          <Choices label="空白区域操作" value={value.blankAreaAction} options={[["context", "右键菜单"], ["double", "双击菜单"]]} onChange={blankAreaAction => onChange({ blankAreaAction })} />
          <Choices label="滚轮默认操作" value={value.wheelDefaultAction} options={[["pan", "平移"], ["zoom", "缩放"]]} onChange={wheelDefaultAction => onChange({ wheelDefaultAction })} />
          <Toggle label="拖拽吸附网格" checked={value.snapToGrid} onChange={snapToGrid => onChange({ snapToGrid })} />
          <Toggle label="对齐辅助线" checked={value.alignmentGuides} onChange={alignmentGuides => onChange({ alignmentGuides })} />
          <Toggle label="拖动后选中节点" checked={value.focusOnDrag} onChange={focusOnDrag => onChange({ focusOnDrag })} />
          <Toggle label="提交后取消选中" checked={value.clearFocusAfterSubmit} onChange={clearFocusAfterSubmit => onChange({ clearFocusAfterSubmit })} />
          <Toggle label="视频悬停预览" checked={value.hoverVideoAutoplay} onChange={hoverVideoAutoplay => onChange({ hoverVideoAutoplay })} />
          <Toggle label="减少动效" checked={value.reduceMotion} onChange={reduceMotion => onChange({ reduceMotion })} />
          <p className="canvas-settings-help">定位动画上限设为 0 时直接跳转。减少动效同时关闭画布移动和界面过渡动画。</p>
          <p className="canvas-settings-help">Ctrl / ⌘ + 滚轮始终缩放，Shift + 滚轮临时平移。</p>
        </section>
        <section id="canvas-settings-notifications" ref={el => { sections.current.notifications = el; }} className="canvas-settings-section">
          <h3>任务提示</h3>
          <p className="canvas-settings-help">结果在当前视野且已选中时不重复提示；失败详情通过全局提示反馈。</p>
          <Toggle label="后台任务完成提示" checked={value.notifyGeneration} onChange={notifyGeneration => onChange({ notifyGeneration })} />
          <Toggle label="生成失败提示" checked={value.notifyFailure} onChange={notifyFailure => onChange({ notifyFailure })} />
        </section>
        <section id="canvas-settings-connections" ref={el => { sections.current.connections = el; }} className="canvas-settings-section">
          <h3>连线设置</h3>
          <Choices label="连线样式" value={value.connectionStyle} options={[["bezier", "曲线"], ["straight", "直线"], ["orthogonal", "正交"]]} onChange={connectionStyle => onChange({ connectionStyle })} />
          <Choices label="连线颜色" value={value.connectionColor} options={[["muted", "柔和"], ["accent", "强调色"], ["node", "节点色"]]} onChange={connectionColor => onChange({ connectionColor })} />
          <Toggle label="显示节点连线" checked={value.showEdges} onChange={showEdges => onChange({ showEdges })} />
          <Toggle label="显示连线箭头" checked={value.showConnectionArrows} onChange={showConnectionArrows => onChange({ showConnectionArrows })} />
          <Toggle label="端口磁性吸附" checked={value.magneticSnap} onChange={magneticSnap => onChange({ magneticSnap })} />
          <Toggle label="显示连线预览" checked={value.connectionPreview} onChange={connectionPreview => onChange({ connectionPreview })} />
        </section>
        <section id="canvas-settings-grid" ref={el => { sections.current.grid = el; }} className="canvas-settings-section">
          <h3>网格与布局</h3>
          <Toggle label="显示网格" checked={value.gridVisible} onChange={gridVisible => onChange({ gridVisible })} />
          <Choices label="网格样式" value={value.gridStyle} options={[["dots", "点阵"], ["lines", "线条"]]} onChange={gridStyle => onChange({ gridStyle })} />
          <Choices label="网格间距" value={value.gridSize} options={[[10, "10"], [20, "20"], [40, "40"]]} onChange={gridSize => onChange({ gridSize })} />
          <Toggle label="显示小地图" checked={value.showMinimap} onChange={showMinimap => onChange({ showMinimap })} />
          <Toggle label="显示节点状态标签" checked={value.showNodeStatus} onChange={showNodeStatus => onChange({ showNodeStatus })} />
          <Choices label="节点内容密度" value={value.nodeDensity} options={[["comfortable", "舒适"], ["compact", "紧凑"]]} onChange={nodeDensity => onChange({ nodeDensity })} />
          <p className="canvas-settings-help">点击画布工具栏的「智能整理」即可自动识别工作流、分组和独立节点，并选择合适的布局方式；网格吸附使用设定间距，不受缩放影响。</p>
        </section>
        <section id="canvas-settings-appearance" ref={el => { sections.current.appearance = el; }} className="canvas-settings-section">
          <h3>画布外观</h3>
          <div className="canvas-setting-swatches" role="group" aria-label="画布底色">{([["midnight", "深夜"], ["graphite", "石墨"], ["warm", "暖灰"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={value.backgroundPreset === id} className={`canvas-setting-swatch is-${id}${value.backgroundPreset === id ? " is-selected" : ""}`} onClick={() => onChange({ backgroundPreset: id })}><i aria-hidden="true" />{label}</button>)}</div>
          <Choices label="强调色" value={value.accent} options={[["mono", "黑白"], ["cyan", "青色"], ["violet", "紫色"]]} onChange={accent => onChange({ accent })} />
        </section>
        {children && <section id="canvas-settings-account" ref={el => { sections.current.account = el; }} className="canvas-settings-section canvas-settings-account">{children}</section>}
      </div>
    </div>
  </div>;
}
