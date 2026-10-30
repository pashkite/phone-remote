// Export licensed Phosphor light paths unchanged to Android VectorDrawable.
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
const names = {home:'House',link:'Link',phone:'DeviceMobile',settings:'GearSix',shield:'ShieldCheck',stats:'ChartLine',files:'Folder',clipboard:'ClipboardText',audio:'SpeakerHigh',power:'Power',close:'X',devices:'Devices',refresh:'ArrowsClockwise',moon:'Moon',bell:'Bell',keyboard:'Keyboard'};
const directory = new URL('../android-client/app/src/main/res/drawable/',import.meta.url);
function paths(node) {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(paths);
  if (node.type === 'path') return [node.props.d];
  return paths(node.props?.children);
}
for (const [name,symbol] of Object.entries(names)) {
  const {default:weights} = await import(`../node_modules/@phosphor-icons/react/dist/defs/${symbol}.es.js`);
  const data = paths(weights.get('light'));
  if (!data.length) throw Error(`No paths for ${symbol}`);
  writeFileSync(new URL(`ic_ui_${name}.xml`,directory),`<?xml version="1.0" encoding="utf-8"?>\n<!-- Phosphor ${symbol}, light. MIT. See assets/licenses/phosphor-icons.txt. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="22dp" android:height="22dp" android:viewportWidth="256" android:viewportHeight="256">\n${data.map(d=>`    <path android:fillColor="@color/nav_tint" android:pathData="${d}"/>`).join('\n')}\n</vector>\n`);
}
mkdirSync(new URL('../assets/licenses/',import.meta.url),{recursive:true});
copyFileSync(new URL('../node_modules/@phosphor-icons/react/LICENSE',import.meta.url),new URL('../assets/licenses/phosphor-icons.txt',import.meta.url));
console.log(`Exported ${Object.keys(names).length} Phosphor light Android icons.`);
