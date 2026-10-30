"""Verify the ADB preflight never silently escalates to a destructive probe."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("preflight", Path(__file__).parents[1] / "panel-preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightSafetyTest(unittest.TestCase):
    def invoke(self, options=(), help_text="power-off DISPLAY_ID\npower-reset DISPLAY_ID"):
        commands = []

        def run(command, **kwargs):
            self.assertNotIn("shell", kwargs)  # no host shell interpolation
            self.assertEqual(command[:3], ["adb", "-s", "test-device"])
            commands.append(command[3:])
            output = "device\n" if command[3:] == ["get-state"] else ""
            if command[-3:] == ["cmd", "display", "help"]:
                output = help_text
            return subprocess.CompletedProcess(command, 0, output, "")

        with patch("sys.argv", ["preflight", "--serial", "test-device", *options]), \
                patch.object(preflight.subprocess, "run", side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()):
            preflight.main()
        return commands

    def test_default_is_read_only(self):
        commands = self.invoke()
        allowed = {"get-state", "getprop", "dumpsys", "cmd"}
        for command in commands:
            self.assertIn(command[1] if command[0] == "shell" else command[0], allowed)
            if command[0:2] == ["shell", "cmd"]:
                self.assertEqual(command, ["shell", "cmd", "display", "help"])

    def test_explicit_probe_only_restores_fixed_display(self):
        commands = self.invoke(["--probe-recovery"])
        self.assertEqual(commands[-1], ["shell", "cmd", "display", "power-reset", "0"])
        self.assertFalse(any("power-off" in command for command in commands))

    def test_power_on_firmware_is_supported(self):
        commands = self.invoke(["--probe-recovery"], "power-off DISPLAY_ID\npower-on DISPLAY_ID")
        self.assertEqual(commands[-1][-2:], ["power-on", "0"])

    def test_missing_recovery_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "STOP"):
            self.invoke(["--probe-recovery"], "power-off DISPLAY_ID")


if __name__ == "__main__":
    unittest.main()
