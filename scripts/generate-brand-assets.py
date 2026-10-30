#!/usr/bin/env python3
"""Compatibility entry point for current Linro exports; never restore historic Galaxy branding."""
from pathlib import Path
import runpy
if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).resolve().with_name('generate-linro-assets.py')),run_name='__main__')
