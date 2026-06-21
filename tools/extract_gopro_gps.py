import argparse
import csv
import json
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

GPX_FORMAT = """#[HEAD]<?xml version="1.0" encoding="utf-8"?>
#[HEAD]<gpx version="1.1" creator="ExifTool $ExifToolVersion"
#[HEAD] xmlns="http://www.topografix.com/GPX/1/1"
#[HEAD] xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
#[HEAD] xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
#[HEAD]<trk>
#[HEAD]<name>$FileName</name>
#[HEAD]<trkseg>
#[BODY]<trkpt lat="${GPSLatitude#}" lon="${GPSLongitude#}">
#[BODY]  <ele>${GPSAltitude#}</ele>
#[BODY]  <time>${GPSDateTime#}</time>
#[BODY]</trkpt>
#[TAIL]</trkseg>
#[TAIL]</trk>
#[TAIL]</gpx>
"""


def find_value(data, suffixes):
    for key, value in data.items():
        normalized = key.lower().replace(":", "")
        for suffix in suffixes:
            if normalized.endswith(suffix.lower()):
                return value
    return None


def to_float(value):
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except ValueError:
        return None


def normalize_gps_time(value):
    text = str(value or "").strip()
    if not text:
        return ""

    match = re.match(r"(\d{4}):(\d{2}):(\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)", text)
    if match:
        year, month, day, time_section = match.groups()
        return f"{year}-{month}-{day}T{time_section}Z"

    return text


def is_valid_coordinate(lat, lng, keep_zero):
    if lat is None or lng is None:
        return False
    if not keep_zero and lat == 0 and lng == 0:
        return False
    return -90 <= lat <= 90 and -180 <= lng <= 180


def extract_points(video_path, exiftool):
    command = [
        exiftool,
        "-G",
        "-j",
        "-ee",
        str(video_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=True)
    payload = json.loads(result.stdout)
    if not payload:
        return []

    streams = payload[0].get("GoPro:Stream")
    if not isinstance(streams, list):
        return []

    points = []
    for index, item in enumerate(streams):
        if not isinstance(item, dict):
            continue
        lat = to_float(find_value(item, ["GpsLatitude", "GPSLatitude"]))
        lng = to_float(find_value(item, ["GpsLongitude", "GPSLongitude"]))
        if lat is None or lng is None:
            continue
        altitude = to_float(find_value(item, ["GpsAltitude", "GPSAltitude"]))
        gps_time = find_value(item, ["GpsDateTime", "GPSDateTime", "TimeStamp", "SampleTime"])
        points.append({
            "index": index,
            "latitude": lat,
            "longitude": lng,
            "altitude": altitude,
            "gps_time": gps_time or "",
        })

    return points


def extract_gpx_block(raw_output):
    gpx_start = raw_output.find("<?xml")
    gpx_end = raw_output.lower().find("</gpx>")
    if gpx_start < 0 or gpx_end < 0:
        return ""
    return raw_output[gpx_start:gpx_end + len("</gpx>")]


def extract_points_with_gpx_format(video_path, exiftool, keep_zero=False):
    with tempfile.NamedTemporaryFile("w", suffix=".fmt", delete=False, encoding="utf-8") as fmt_file:
        fmt_file.write(GPX_FORMAT)
        fmt_path = fmt_file.name

    try:
        command = [
            exiftool,
            "-p",
            fmt_path,
            "-ee",
            "-m",
            str(video_path),
        ]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True)
    finally:
        Path(fmt_path).unlink(missing_ok=True)

    gpx_text = extract_gpx_block(result.stdout)
    if not gpx_text:
        return []

    root = ET.fromstring(gpx_text.encode("utf-8", "ignore"))
    namespace_match = re.match(r"\{(.+)\}", root.tag)
    namespace = namespace_match.group(1) if namespace_match else ""
    ns = {"gpx": namespace} if namespace else {}
    track_points = root.findall(".//gpx:trkpt", ns) if namespace else root.findall(".//trkpt")

    points = []
    for index, point_node in enumerate(track_points):
        lat = to_float(point_node.attrib.get("lat"))
        lng = to_float(point_node.attrib.get("lon"))
        if not is_valid_coordinate(lat, lng, keep_zero):
            continue

        ele_node = point_node.find("gpx:ele", ns) if namespace else point_node.find("ele")
        time_node = point_node.find("gpx:time", ns) if namespace else point_node.find("time")
        points.append({
            "index": index,
            "latitude": lat,
            "longitude": lng,
            "altitude": to_float(ele_node.text if ele_node is not None else None),
            "gps_time": normalize_gps_time(time_node.text if time_node is not None else ""),
        })

    return points


def main():
    parser = argparse.ArgumentParser(description="Extract GoPro GPS points to CSV without video analysis.")
    parser.add_argument("video", help="Input GoPro video file")
    parser.add_argument("output_csv", help="Output CSV path")
    parser.add_argument("--exiftool", default="exiftool", help="Path to exiftool executable")
    parser.add_argument("--keep-zero", action="store_true", help="Keep 0,0 GPS points. Usually not needed.")
    args = parser.parse_args()

    video_path = Path(args.video)
    output_path = Path(args.output_csv)

    if not video_path.exists():
        print(f"Video file not found: {video_path}", file=sys.stderr)
        return 1

    try:
        points = extract_points(video_path, args.exiftool)
        if not points:
            points = extract_points_with_gpx_format(video_path, args.exiftool, keep_zero=args.keep_zero)
    except FileNotFoundError:
        print("exiftool was not found. Install ExifTool or pass --exiftool path.", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as error:
        print(error.stderr or str(error), file=sys.stderr)
        return 1

    if not points:
        print("No GPS points were found in the video.", file=sys.stderr)
        return 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=["index", "latitude", "longitude", "altitude", "gps_time"])
        writer.writeheader()
        writer.writerows(points)

    print(f"Extracted {len(points)} GPS points: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
