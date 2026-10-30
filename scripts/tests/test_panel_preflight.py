"""Verify the ADB preflight never silently escalates to a destructive probe."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("preflight", Path(__file__).parents[1] / "panel-preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightSafetyTest(unittest.TestCase):
    def invoke(self, options=(), help_text="Display manager commands:\n  help\n  power-off DISPLAY_ID\n  power-reset DISPLAY_ID", help_exit=0, help_stderr=False, control_exit=0):
        commands = []

        def run(command, **kwargs):
            self.assertNotIn("shell", kwargs)  # no host shell interpolation
            self.assertEqual(command[:3], ["adb", "-s", "test-device"])
            commands.append(command[3:])
            output = "device\n" if command[3:] == ["get-state"] else ""
            if command[-3:] == ["cmd", "display", "help"]:
                output = help_text
            exit_code = 0
            stderr = ""
            if command[-3:] == ["cmd", "display", "help"]:
                exit_code = help_exit
                if help_stderr: output, stderr = "", help_text
            elif command[-2:] in (["power-reset", "0"], ["power-on", "0"]): exit_code = control_exit
            return subprocess.CompletedProcess(command, exit_code, output, stderr)

        self.last_commands = commands
        captured = io.StringIO()
        with patch("sys.argv", ["preflight", "--serial", "test-device", *options]), \
                patch.object(preflight.subprocess, "run", side_effect=run), \
                contextlib.redirect_stdout(captured):
            preflight.main()
        self.report = json.loads(captured.getvalue())
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
        commands = self.invoke(["--probe-recovery"], "Display manager commands:\n  help\n  power-off DISPLAY_ID\n  power-on DISPLAY_ID")
        self.assertEqual(commands[-1][-2:], ["power-on", "0"])

    def test_missing_recovery_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "STOP"):
            self.invoke(["--probe-recovery"], "Display manager commands:\n  help\n  power-off DISPLAY_ID")


    def test_normal_help_nonzero_status_is_recorded_not_rejected(self):
        for exit_code in (0, -1, 255):
            self.invoke(help_exit=exit_code, help_stderr=exit_code != 0)
            self.assertEqual(self.report["help_exit_code"], exit_code)
            self.assertTrue(self.report["command_support_known"])
            self.assertTrue(self.report["off_advertised"])
            self.assertEqual(self.report["hardware_off"], "UNVERIFIED")
            self.assertIn("Display manager commands:", self.report["help_output"])

    def test_unrecognized_help_blocks_recovery_probe(self):
        with self.assertRaisesRegex(RuntimeError, "STOP"):
            self.invoke(["--probe-recovery"], "Permission denial: display", help_exit=-1)
        self.assertFalse(any("power-reset" in command or "power-on" in command for command in self.last_commands))

    def test_actual_control_failure_stays_strict_without_alternate_command(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke(["--probe-recovery"], control_exit=-1)
        self.assertEqual(self.last_commands[-1][-2:], ["power-reset", "0"])
        self.assertFalse(any("power-on" in command or "power-off" in command for command in self.last_commands))

    def test_full_help_matches_declarations_not_prose_or_prefixes(self):
        self.invoke(help_text="Display manager commands:\n  help\n  power-off-extra ID\n    power-reset is mentioned here.\n")
        self.assertFalse(self.report["off_advertised"])
        self.assertIsNone(self.report["recovery_candidate"])
        self.invoke(help_text="Display manager commands:\n  help\n" + "    documentation\n" * 100 + "  power-off DISPLAY_ID\n  power-on DISPLAY_ID\n")
        self.assertTrue(self.report["off_advertised"])
        self.assertEqual(self.report["recovery_candidate"], "power-on")

if __name__ == "__main__":
    unittest.main()
