import { existsSync, readFileSync } from 'node:fs';

export function patchPowderArrowIcon(ctx) {
  const file = 'js/00-data.js';
  const icon = 'assets/icons/items/無限火藥爆裂矢.png';
  let source = readFileSync(file, 'utf8');
  const before = '"relic_powder_arrow":      { n: "無限火藥爆裂矢",     type: "wpn", isArrow: true,';
  const after = '"relic_powder_arrow":      { n: "無限火藥爆裂矢",     type: "wpn", img: "assets/icons/items/無限火藥爆裂矢.png", isArrow: true,';

  if (source.includes(after)) {
    ctx.markAlready();
  } else {
    source = ctx.replaceOnce(file, source, before, after, '無限火藥爆裂矢圖示綁定');
    ctx.writePatched(file, source, '無限火藥爆裂矢圖示綁定');
  }
  if (!existsSync(icon)) {
    throw new Error(`[${icon}] 缺少 PP v3.8.34 圖示資產。`);
  }
  ctx.markAlready();
}
