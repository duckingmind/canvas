export type CharacterTurnaroundPromptInput = {
  name?: string;
  notes?: string;
  preserveStyle?: boolean;
  includeAccessories?: boolean;
};

/**
 * Build the stable visual contract for a character turnaround sheet.
 *
 * A turnaround is intentionally one composed sheet: the three views share
 * identity, clothes, proportions and lighting, so the result can be reused as
 * a reference asset by later image/video nodes.
 */
export function buildCharacterTurnaroundPrompt(input: CharacterTurnaroundPromptInput = {}) {
  const name = input.name?.trim() || "当前角色";
  const notes = input.notes?.trim();
  const styleRule = input.preserveStyle !== false
    ? "保留参考图的绘画或渲染媒介、色彩倾向、线条/材质语言和角色气质"
    : "以参考图为身份依据，允许使用更清晰的专业角色设定稿表现";
  const accessoryRule = input.includeAccessories === false
    ? "不额外添加道具；只保留能确认角色身份的服装结构"
    : "保留参考图中能确认角色身份的服装、配饰和道具，并保持三视图一致";
  return [
    `制作「${name}」的专业人物三视图设定表。`,
    "画面严格分成三个等宽竖向区域，从左到右依次为正面全身、右侧面全身、背面全身。",
    "三个视角必须是同一角色、同一发型、同一服装、同一体型和同一身高比例，采用站立中性姿势，完整显示头顶到脚底。",
    styleRule + "。",
    accessoryRule + "。",
    "使用干净、均匀、低干扰的浅色设定稿背景和一致光线；只呈现角色，不要额外人物。",
    "不要加入标题、文字、标签、边框、分隔线、尺寸标注、动作姿势、表情变化或拼贴效果。",
    notes ? `补充约束：${notes}` : "",
  ].filter(Boolean).join("\n");
}

