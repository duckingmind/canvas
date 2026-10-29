/** Create a default image prompt through the canvas's persistent node picker. */
export async function createImageNode(page) {
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "添加节点", exact: true });
  await picker.getByRole("button", { name: /图片生成/ }).click();
}
