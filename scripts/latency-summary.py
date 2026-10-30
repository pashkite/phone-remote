#!/usr/bin/env python3
"""Summarize independently measured input-to-display latency; never derive it from RTT."""
import argparse
import csv
import json
import math
from pathlib import Path


def summarize(samples):
    if not samples or any(not math.isfinite(v) or v < 0 for v in samples):
        raise ValueError("Provide finite nonnegative independently measured latency_ms values")
    ordered = sorted(samples)
    return {"samples": len(ordered), "median_ms": (ordered[(len(ordered)-1)//2] + ordered[len(ordered)//2])/2,
            "p95_ms": ordered[math.ceil(.95*len(ordered))-1], "worst_ms": ordered[-1],
            "method": "nearest-rank p95 of independently measured latency_ms; not RTT"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="CSV containing a latency_ms column from high-speed-camera/instrumented measurements")
    args = parser.parse_args()
    with args.csv.open(newline="") as source:
        samples = [float(row["latency_ms"]) for row in csv.DictReader(source)]
    print(json.dumps(summarize(samples), indent=2))


if __name__ == "__main__":
    main()
