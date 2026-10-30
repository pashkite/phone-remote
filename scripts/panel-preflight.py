#!/usr/bin/env python3
"""Read-only by default. Never issues OFF, sleep, lock, input, or settings changes."""
import argparse
import json
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial", required=True, help="Explicit device serial from adb devices -l")
    parser.add_argument("--probe-recovery", action="store_true",
                        help="Only execute advertised power-reset/power-on on display 0 while already ON")
    args = parser.parse_args()

    def adb(*command):
        result = subprocess.run([args.adb, "-s", args.serial, *command],
                                capture_output=True, text=True, timeout=15, check=True)
        return result.stdout

    if adb("get-state").strip() != "device":
        raise RuntimeError("Device is not authorized")
    help_text = adb("shell", "cmd", "display", "help")
    recovery = next((x for x in ("power-reset", "power-on") if x in help_text), None)
    report = {
        "model": adb("shell", "getprop", "ro.product.model").strip(),
        "sdk": adb("shell", "getprop", "ro.build.version.sdk").strip(),
        "fingerprint": adb("shell", "getprop", "ro.build.fingerprint").strip(),
        "recovery_candidate": recovery,
        "off_advertised": "power-off" in help_text,
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
