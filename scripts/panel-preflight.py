#!/usr/bin/env python3
"""Read-only by default. Never issues OFF, sleep, lock, input, or settings changes."""
import argparse
import json
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial", required=True, help="Explicit device serial from adb devices -l")
    parser.add_argument("--probe-recovery", action="store_true",
                        help="Only execute advertised power-reset/power-on on display 0 while already ON")
    args = parser.parse_args()

    def query(*command):
        return subprocess.run([args.adb, "-s", args.serial, *command],
                              capture_output=True, text=True, timeout=15, check=False)

    def adb(*command):
        result = query(*command)
        if result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)
        return result.stdout

    if adb("get-state").strip() != "device":
        raise RuntimeError("Device is not authorized")
    help_result = query("shell", "cmd", "display", "help")
    help_text = help_result.stdout + ("\n" + help_result.stderr if help_result.stderr else "")
    declarations = list(re.finditer(r"(?m)^([\t ]*)(help|power-off|power-reset|power-on|set-brightness|get-brightness|get-displays)(?=\s|$)", help_text))
    indent = min((len(m[1].expandtabs(4)) for m in declarations), default=None)
    commands = {m[2] for m in declarations if len(m[1].expandtabs(4)) == indent}
    known = bool(re.search(r"(?im)^\s*Display manager commands\s*:", help_text) and commands) and not re.search(
        r"(?im)^\s*(?:permission denial|permission denied|securityexception|error:|exception[^a-z]|java\.[^\n]*exception)", help_text)
    recovery = next((x for x in ("power-reset", "power-on") if known and x in commands), None)
    report = {
        "model": adb("shell", "getprop", "ro.product.model").strip(),
        "sdk": adb("shell", "getprop", "ro.build.version.sdk").strip(),
        "fingerprint": adb("shell", "getprop", "ro.build.fingerprint").strip(),
        "help_exit_code": help_result.returncode,
        "help_output": help_text,
        "command_support_known": bool(known),
        "recovery_candidate": recovery,
        "off_advertised": bool(known and "power-off" in commands),
        "display": adb("shell", "dumpsys", "display"),
        "power": adb("shell", "dumpsys", "power"),
        "window": adb("shell", "dumpsys", "window", "policy"),
        "hardware_off": "UNVERIFIED",
        "recovery_from_off": "UNVERIFIED",
    }
    if args.probe_recovery:
        if recovery is None:
            raise RuntimeError("No advertised recovery command: STOP; do not turn OFF")
        report["recovery_probe_output"] = adb("shell", "cmd", "display", recovery, "0")
        report["probe_limit"] = "Command acceptance while ON is not proof of recovery from OFF"
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
