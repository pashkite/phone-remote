import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('apk_identity',Path(__file__).resolve().parents[1]/'verify-device-test-apk.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class ApkIdentityTest(unittest.TestCase):
    def test_signature_or_package_change_never_becomes_an_update(self):
        old={'package':'com.galaxyremote.app.paneltest','versionCode':17};current={**old,'versionCode':18,'label':'린로','abis':['arm64-v8a']}
        m.validate(current,old,{'a'*64},{'a'*64})
        for patch,signers in [({}, {'b'*64}),({'package':'com.galaxyremote.app'}, {'a'*64}),({'versionCode':17},{'a'*64}),({'abis':['x86_64']},{'a'*64}),({'label':'Linro Test'},{'a'*64})]:
            with self.assertRaises(ValueError):m.validate({**current,**patch},old,signers,{'a'*64})
    def test_missing_badging_or_certificate_is_rejected(self):
        with self.assertRaises(ValueError):m.parse_badging('')
        with self.assertRaises(ValueError):m.certs('certificate unavailable')
