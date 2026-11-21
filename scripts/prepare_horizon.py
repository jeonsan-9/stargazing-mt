"""Build site horizons from local Copernicus DEM tiles for sky.html."""

import argparse
import json
from pathlib import Path
import re

import numpy as np
from pyproj import Geod
import rasterio


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dem", type=Path, help="Directory containing Copernicus DEM GeoTIFF tiles")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sites = re.findall(r'id: "(\w+)", name: "[^"\n]+", region: "[^"\n]+", lat: ([\d.]+), lon: ([\d.]+)',
                       (root / "js/sites.js").read_text(encoding="utf-8"))
    tiles = {}
    for file in args.dem.glob("Copernicus_DSM*.tif"):
        match = re.search(r"_N(\d+)_00_E(\d+)_00", file.name)
        if match:
            with rasterio.open(file) as dataset:
                tiles[tuple(map(int, match.groups()))] = (dataset.read(1), ~dataset.transform)

    def elevations(lat, lon):
        heights = np.full(lat.shape, np.nan)
        lat_degree, lon_degree = np.floor(lat).astype(int), np.floor(lon).astype(int)
        for (ilat, ilon), (values, transform) in tiles.items():
            selected = (lat_degree == ilat) & (lon_degree == ilon)
            if not np.any(selected):
                continue
            cols, rows = transform * (lon[selected], lat[selected])
            heights[selected] = values[np.clip(rows.astype(int), 0, values.shape[0] - 1),
                                       np.clip(cols.astype(int), 0, values.shape[1] - 1)]
        return np.where((heights >= -100) & (heights <= 3000), heights, np.nan)

    geod = Geod(ellps="WGS84")
    distances = np.r_[np.arange(120, 2000, 60), np.arange(2000, 14000, 180), np.arange(14000, 65001, 550)]
    bearings, lengths = np.meshgrid(np.arange(360), distances, indexing="ij")
    horizons = {}
    for site, latitude, longitude in sites:
        lat, lon = float(latitude), float(longitude)
        observer = elevations(np.array([lat]), np.array([lon]))[0] + 1.7
        if not np.isfinite(observer):
            raise ValueError(f"DEM tile missing for {site}")
        xs, ys, _ = geod.fwd(np.full_like(lengths, lon, dtype=float), np.full_like(lengths, lat, dtype=float), bearings, lengths)
        relative = elevations(ys, xs) - observer - lengths**2 / (2 * 6371000)
        angles = np.rad2deg(np.arctan2(relative, lengths))
        ridge = np.max(np.where(np.isfinite(angles), angles, -90), axis=1)
        horizons[site] = {"elevation": round(observer - 1.7), "ridge": np.round(ridge, 2).tolist()}
    if not horizons:
        raise ValueError("No observing sites found")
    (root / "js/diorama/horizons.json").write_text(json.dumps(horizons, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(horizons)} horizons with 360 bearings each.")


if __name__ == "__main__":
    main()
