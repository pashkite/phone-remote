#!/usr/bin/env python3
"""Read-only stage 7 package/signature verification. Never creates a key or installs an app."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


def parse_badging(text):
    package=re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",text,re.M)
    label=re.search(r"^application-label:'([^']+)'",text,re.M)
    abis=re.search(r"^native-code:(.*)$",text,re.M)
    if not package or not label or not abis:raise ValueError('APK identity or ABI is missing')
    return {'package':package[1],'versionCode':int(package[2]),'versionName':package[3],'label':label[1],'abis':re.findall(r"'([^']+)'",abis[1])}


def certs(text):
    result=set(re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$',text,re.M))
    if not result:raise ValueError('No verified signing certificate')
    return {value.lower() for value in result}


def validate(current,previous,signers,old_signers):
    if current['package']!='com.galaxyremote.app.paneltest' or previous['package']!=current['package']:raise ValueError('Test package changed')
    if current['label']!='린로' or current['abis']!=['arm64-v8a']:raise ValueError('Unexpected test label or ABI')
    if current['versionCode']<=previous['versionCode']:raise ValueError('Update versionCode must increase')
    if not signers or signers!=old_signers:raise ValueError('Signing certificate changed; do not uninstall or erase data')


def inspect(apk,tools):
    def run(name,*args):return subprocess.run([str(tools/name),*args],check=True,capture_output=True,text=True).stdout
    identity=parse_badging(run('aapt','dump','badging',str(apk)))
    signers=certs(run('apksigner','verify','--verbose','--print-certs',str(apk)))
    run('zipalign','-c','-P','16','4',str(apk))
    return identity,signers


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('apk',type=Path);p.add_argument('--previous',required=True,type=Path);p.add_argument('--tools-dir',required=True,type=Path);p.add_argument('--output',type=Path);a=p.parse_args()
    current,signers=inspect(a.apk,a.tools_dir);previous,old=inspect(a.previous,a.tools_dir);validate(current,previous,signers,old)
    result={**current,'sha256':hashlib.sha256(a.apk.read_bytes()).hexdigest(),'bytes':a.apk.stat().st_size,'signingCertificateSha256':sorted(signers),'previousVersionCode':previous['versionCode'],'sameTestCertificate':True,'zipAlignment16KiB':True,'deviceInstallVerified':False}
    text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if a.output:a.output.write_text(text)
    print(text)
if __name__=='__main__':main()
