#!/usr/bin/env python3
"""Regenerate raster web/Android assets from the original SVG. Requires Pillow + CairoSVG."""
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import cairosvg
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/brand/galaxy-remote-symbol.svg'
WEB = ROOT / 'public/brand'
RES = ROOT / 'android-client/app/src/main/res'
TEST = ROOT / 'android-client/app/src/panelTest/res'


def render(size):
    return Image.open(io.BytesIO(cairosvg.svg2png(url=str(SOURCE), output_width=size, output_height=size))).convert('RGBA')


def round_icon(icon):
    mask=Image.new('L',icon.size);ImageDraw.Draw(mask).ellipse((0,0,icon.width-1,icon.height-1),fill=255)
    result=icon.copy();result.putalpha(mask);return result


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    for size in (16,32,48,180,192,512):
        render(size).save(WEB/f'icon-{size}.png')
    maskable=Image.new('RGBA',(512,512),'#111C2A');maskable.alpha_composite(render(512));maskable.convert('RGB').save(WEB/'maskable-512.png')
    render(512).save(ROOT/'public/favicon.ico',sizes=[(16,16),(32,32),(48,48)],format='ICO')
    (ROOT/'public/favicon.svg').write_text(SOURCE.read_text())
    (WEB/'symbol.svg').write_text(SOURCE.read_text())
    og=Image.new('RGB',(1200,630),'#111C2A');og.paste(render(240),(110,190),render(240))
    try:
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',56)
        small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',28)
    except OSError: raise RuntimeError('Install DejaVu Sans to regenerate the OG card consistently')
    draw=ImageDraw.Draw(og);draw.text((400,240),'Galaxy Remote 2.0',font=font,fill='#E3EDF7');draw.text((400,320),'Your phone. Your space.',font=small,fill='#67D8CA');og.save(WEB/'social.png')
    for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
        directory=RES/f'mipmap-{density}';directory.mkdir(parents=True,exist_ok=True)
        render(size).save(directory/'ic_launcher.png');round_icon(render(size)).save(directory/'ic_launcher_round.png')
        directory=TEST/f'mipmap-{density}';directory.mkdir(parents=True,exist_ok=True)
        icon=render(size);d=ImageDraw.Draw(icon);d.ellipse((size*.69,size*.69,size*.87,size*.87),fill='#FFBD66');icon.save(directory/'ic_launcher.png');round_icon(icon).save(directory/'ic_launcher_round.png')
    # Preserve the same master paths in Android vectors. Adaptive content remains in safe zone.
    root=ET.parse(SOURCE).getroot();paths=list(root.iter('{http://www.w3.org/2000/svg}path'))
    xml='''<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n<group android:scaleX="0.72" android:scaleY="0.72" android:translateX="19.44" android:translateY="19.44">\n'''
    for p in paths:
        xml+=f'<path android:pathData="{p.attrib["d"]}" android:fillColor="@android:color/transparent" android:strokeColor="{p.attrib["stroke"]}" android:strokeWidth="7" android:strokeLineCap="round" android:strokeLineJoin="round"/>\n'
    xml+='</group></vector>\n'
    (RES/'drawable/ic_brand_foreground.xml').write_text(xml)
    (TEST/'drawable').mkdir(parents=True,exist_ok=True)
    (TEST/'drawable/ic_brand_foreground.xml').write_text(xml.replace('</vector>','<path android:fillColor="#FFBD66" android:pathData="M73,68a5,5 0,1 0,0.01,0Z"/></vector>'))
    (RES/'drawable/ic_brand_monochrome.xml').write_text(xml.replace('#E3EDF7','#FFFFFF').replace('#67D8CA','#FFFFFF'))
    (RES/'drawable/ic_brand_background.xml').write_text('<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#111C2A"/></shape>\n')
    for folder in ('mipmap-anydpi-v26','mipmap-anydpi-v33'):
        directory=RES/folder;directory.mkdir(parents=True,exist_ok=True)
        monochrome='<monochrome android:drawable="@drawable/ic_brand_monochrome"/>' if folder.endswith('33') else ''
        content=f'<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@drawable/ic_brand_background"/><foreground android:drawable="@drawable/ic_brand_foreground"/>{monochrome}</adaptive-icon>\n'
        for name in ('ic_launcher.xml','ic_launcher_round.xml'):(directory/name).write_text(content)
    manifest={'id':'/','name':'Galaxy Remote 2.0','short_name':'Galaxy Remote','description':'Use your own Galaxy phone from your browser.','start_url':'/','scope':'/','display':'standalone','background_color':'#111C2A','theme_color':'#111C2A','icons':[{'src':f'/brand/icon-{n}.png','sizes':f'{n}x{n}','type':'image/png','purpose':'any'} for n in (192,512)]+[{'src':'/brand/maskable-512.png','sizes':'512x512','type':'image/png','purpose':'maskable'}]}
    (ROOT/'public/manifest.webmanifest').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Generated SVG/PNG/ICO/OG, manifest and Android launcher resources.')

if __name__=='__main__': main()
