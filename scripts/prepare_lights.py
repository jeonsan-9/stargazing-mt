"""Render the two map overlays from a NASA VJ146A4 2024 annual radiance GeoTIFF.

Source (snow-free, all angles, reformatted by Jurij Stare / lightpollutionmap.info):
https://www2.lightpollutionmap.info/data/v2/viirs_2024_raw.zip
Usage: python scripts/prepare_lights.py viirs_2024_raw.tif
Requires numpy, rasterio. The halo is an illustration of spill, not a sky-brightness model.
"""
import argparse
import json
from pathlib import Path
import re

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds as window_from_bounds

ROOT = Path(__file__).resolve().parents[1] / "js/diorama"
LOCAL = "+proj=tmerc +lat_0=35.9 +lon_0=127.8 +k=1 +datum=WGS84 +units=m"
MAP_BOUNDS = (124.5, 32.8, 131.0, 38.8)


def blur(field, sigma):
    radius = int(np.ceil(3 * sigma))
    axis = np.arange(-radius, radius + 1)
    kernel = np.exp(-0.5 * (axis / sigma) ** 2)
    for direction in (0, 1):
        field = np.apply_along_axis(np.convolve, direction, field, kernel / kernel.sum(), "same")
    return field


def render(values, transform, projection, bounds, size, km_per_pixel, name):
    radiance = np.zeros((size, size), np.float32)
    reproject(values, radiance, src_crs="EPSG:4326", src_transform=transform,
              dst_crs=projection, dst_transform=from_bounds(*bounds, size, size),
              src_nodata=-9999, dst_nodata=0, resampling=Resampling.average)
    # Urban cores carry the fine street pattern. A low, wider amber glow blends nearby cores.
    core = np.clip(np.log1p(np.maximum(0, radiance - 0.8)) / np.log1p(65), 0, 1) ** 1.45
    spill = blur(core ** 1.4, 6 / km_per_pixel)
    broad = blur(spill, 10 / km_per_pixel)
    opacity = np.clip(0.91 * core + 0.48 * spill + 0.22 * broad, 0, 1)
    tint = core[..., None] ** 0.85
    rgb = np.array([170, 88, 63]) + tint * np.array([85, 141, 107])
    rgba = np.dstack([rgb, 255 * opacity]).round().astype("uint8")
    with rasterio.open(ROOT / name, "w", driver="PNG", width=size, height=size,
                       count=4, dtype="uint8", zlevel=9) as output:
        output.write(rgba.transpose(2, 0, 1))


def site_glow(values, transform):
    # Average nearby light sources by bearing. Profiles are qualitative and share one scale.
    relative_light = np.clip(np.log1p(np.maximum(0, values - 0.8)) / np.log1p(65), 0, 1)
    profiles = {}
    sites = (ROOT.parent / "sites.js").read_text()
    for site, lat, lon in re.findall(r'id: "(\w+)", name: "[^"\n]+", region: "[^"\n]+", lat: ([\d.]+), lon: ([\d.]+)', sites):
        lat, lon = float(lat), float(lon)
        dx = ((np.arange(values.shape[1]) + 0.5) * transform.a + transform.c - lon) * 111.32 * np.cos(np.deg2rad(lat))
        dy = ((np.arange(values.shape[0]) + 0.5) * transform.e + transform.f - lat) * 110.95
        distance = np.hypot(dx[None, :], dy[:, None])
        selected = (distance < 65) & (values > -9990)
        y, x = np.where(selected)
        bins = np.floor((np.rad2deg(np.arctan2(dx[x], dy[y])) + 365) % 360 / 10).astype(int)
        weight = np.exp(-distance[selected] / 24) / (distance[selected] + 2)
        source = np.bincount(bins, relative_light[selected] * weight, minlength=36)
        norm = np.bincount(bins, weight, minlength=36)
        field = source / np.maximum(norm, 1e-9)
        smooth = sum(np.roll(field, shift) * w for shift, w in [(-2, .1), (-1, .2), (0, .4), (1, .2), (2, .1)])
        profiles[site] = np.minimum(1, 2.2 * smooth).round(3).tolist()
    (ROOT / "city-horizons.json").write_text(json.dumps(profiles, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    with rasterio.open(args.source) as src:
        if src.crs.to_epsg() != 4326:
            raise ValueError("Expected a WGS84 lon/lat radiance raster")
        # Read just South Korea and a margin for the blur.
        region = window_from_bounds(123, 32, 132.5, 40, src.transform).round_offsets().round_lengths()
        data = src.read(1, window=region, masked=True, boundless=True).astype("float32").filled(-9999)
        transform = src.window_transform(region)
    render(data, transform, LOCAL, (-340000, -340000, 340000, 340000), 896, 680 / 896, "lights-terrain.png")
    mercator = transform_bounds("EPSG:4326", "EPSG:3857", *MAP_BOUNDS)
    render(data, transform, "EPSG:3857", mercator, 896, 0.70, "lights-map.png")
    site_glow(data, transform)


if __name__ == "__main__":
    main()
