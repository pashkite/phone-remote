#!/usr/bin/env python3
"""Sign an update with the original key and reject mismatched certificates.

Passwords are supplied only through GALAXY_STORE_PASSWORD/GALAXY_KEY_PASSWORD
environment variables. Never generates keys or modifies the published APK.
"""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def run(command):
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        # Signing tools can include key paths or other sensitive values in errors.
        raise RuntimeError("Android signing tool failed; no update APK was published.")
    return result.stdout


def certificates(apksigner, apk):
    output = run([apksigner, "verify", "--verbose", "--print-certs", str(apk)])
    values = re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})", output)
    if not values:
        raise RuntimeError("No verified signing certificate found.")
    return {value.lower() for value in values}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("unsigned_apk", type=Path)
    parser.add_argument("previous_apk", type=Path)
    parser.add_argument("output_apk", type=Path)
    parser.add_argument("--keystore", required=True, type=Path)
    parser.add_argument("--alias", required=True)
    args = parser.parse_args()
    for file in (args.unsigned_apk, args.previous_apk, args.keystore):
        if not file.is_file():
            parser.error("An input file is missing.")
    if args.output_apk.exists():
        parser.error("Output already exists; choose a new path.")
    for variable in ("GALAXY_STORE_PASSWORD", "GALAXY_KEY_PASSWORD"):
        if not os.environ.get(variable):
            parser.error(f"Set {variable} in the environment.")
    apksigner, zipalign = shutil.which("apksigner"), shutil.which("zipalign")
    if not apksigner or not zipalign:
        parser.error("Add Android SDK build-tools to PATH.")
    args.output_apk.parent.mkdir(parents=True, exist_ok=True)
    expected = certificates(apksigner, args.previous_apk)
    with tempfile.TemporaryDirectory(dir=args.output_apk.parent) as directory:
        aligned = Path(directory) / "aligned.apk"
        signed = Path(directory) / "signed.apk"
        run([zipalign, "-P", "16", "-f", "4", str(args.unsigned_apk), str(aligned)])
        run([apksigner, "sign", "--ks", str(args.keystore), "--ks-key-alias", args.alias,
             "--ks-pass", "env:GALAXY_STORE_PASSWORD", "--key-pass", "env:GALAXY_KEY_PASSWORD",
             "--out", str(signed), str(aligned)])
        if certificates(apksigner, signed) != expected:
            raise RuntimeError("Signing certificate differs from the existing APK; update rejected.")
        run([zipalign, "-c", "-P", "16", "4", str(signed)])
        # Exclusive create prevents overwriting an existing download or concurrent output.
        with args.output_apk.open("xb") as target, signed.open("rb") as source:
            shutil.copyfileobj(source, target)
    print("Certificate and ZIP alignment checks passed. In-place device upgrade remains unverified.")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error))
