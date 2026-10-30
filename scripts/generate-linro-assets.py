#!/usr/bin/env python3
"""Export the approved Linro reference + separately derived adaptive foreground.
The repository reference is 256px; upscales are never called a canonical 1024px original.
"""
import base64
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
R=Path(__file__).resolve().parents[1]
SOURCE=R/'assets/brand/linro/reference-256.webp'
FOREGROUND=R/'assets/brand/linro/adaptive-foreground-derived.png'
WEB=R/'public/brand'
RES=R/'android-client/app/src/main/res'
TEST=R/'android-client/app/src/panelTest/res'
BG='#0B1B3D'

def fit(image,size):
    return image.resize((size,size),Image.Resampling.LANCZOS)

def round_icon(image):
    mask=Image.new('L',image.size);ImageDraw.Draw(mask).ellipse((0,0,image.width-1,image.height-1),fill=255)
    result=image.copy();result.putalpha(mask);return result

def beta(image,adaptive=False):
    image=image.copy();n=image.width;draw=ImageDraw.Draw(image);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',max(6,round(n*.105)))
    box=(n*.38,n*.63,n*.65,n*.75) if adaptive else (n*.34,n*.735,n*.69,n*.895);draw.rounded_rectangle(box,radius=n*.03,fill=BG,outline='#91BFFF',width=max(1,round(n*.01)))
    draw.text((n*.515,n*(.69 if adaptive else .815)),'BETA',font=font,anchor='mm',fill='#F8FAFF');return image

def main():
    source=Image.open(SOURCE).convert('RGBA');foreground=Image.open(FOREGROUND).convert('RGBA');WEB.mkdir(parents=True,exist_ok=True)
    for n in (16,32,48,180,192,512):fit(source,n).save(WEB/f'icon-{n}.png')
    # Keep the approved tile; make maskable canvas opaque. Its connection point is central.
    maskable=Image.new('RGBA',(512,512),BG);maskable.alpha_composite(fit(source,512));maskable.convert('RGB').save(WEB/'maskable-512.png')
    fit(source,512).save(R/'public/favicon.ico',sizes=[(16,16),(32,32),(48,48)],format='ICO')
    b=io.BytesIO();source.save(b,format='PNG');data=base64.b64encode(b.getvalue()).decode()
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="린로 Linro"><image width="256" height="256" href="data:image/png;base64,{data}"/></svg>\n'
    for p in [R/'assets/brand/linro/linro-symbol.svg',R/'public/favicon.svg',WEB/'symbol.svg']:p.write_text(svg)
    og=Image.new('RGB',(1200,630),BG);tile=fit(source,240);og.paste(tile,(110,190),tile);d=ImageDraw.Draw(og)
    font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';d.text((400,230),'Linro',font=ImageFont.truetype(font,78),fill='#F8FAFF');d.text((400,330),'Link Road',font=ImageFont.truetype(font,30),fill='#91BFFF');og.save(WEB/'social.png')
    for density,n in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
        for root,test in [(RES,False),(TEST,True)]:
            folder=root/f'mipmap-{density}';folder.mkdir(parents=True,exist_ok=True);icon=fit(source,n);icon=beta(icon) if test else icon
            icon.save(folder/'ic_launcher.png');round_icon(icon).save(folder/'ic_launcher_round.png')
    # Bitmaps with real transparency; not the rounded-square tile in an adaptive foreground.
    for root,test in [(RES,False),(TEST,True)]:
        folder=root/'drawable-nodpi';folder.mkdir(parents=True,exist_ok=True);image=fit(foreground,512)
        (beta(image,adaptive=True) if test else image).save(folder/'linro_foreground.png')
        (root/'drawable/ic_brand_foreground.xml').write_text('<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/linro_foreground" android:gravity="fill"/>\n')
    mask=Image.new('RGBA',(512,512),'white');mask.putalpha(fit(foreground,512).getchannel('A'));mask.save(RES/'drawable-nodpi/linro_monochrome.png')
    (RES/'drawable/ic_brand_monochrome.xml').write_text('<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/linro_monochrome" android:gravity="fill"/>\n')
    (RES/'drawable/ic_brand_background.xml').write_text(f'<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="{BG}"/></shape>\n')
    m=json.loads((R/'public/manifest.webmanifest').read_text());m.update(name='린로',short_name='Linro',description='Linro · Link Road — 개인용 갤럭시 원격 콘솔',theme_color=BG,background_color=BG);(R/'public/manifest.webmanifest').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
    print('Exported Linro reference assets. 256px preview and derived foreground retain separate provenance.')
if __name__=='__main__':main()
