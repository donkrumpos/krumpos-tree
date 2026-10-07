#!/usr/bin/env python3
"""Write public/map/parchment.json: the life map's basemap style.

A lean OpenFreeMap (OpenMapTiles schema) style toned to the site palette in
src/styles/global.css. Hand-built rather than a recolor of a stock style, so
every layer here is one the map actually wants: land, water, relief at low
zoom, quiet roads, borders, and sparse labels. Re-run after editing; the JSON
is committed so the build never depends on this script.
"""
import json
from pathlib import Path

INK = "#3d2e1e"          # --color-dark-brown
LABEL = "#7d7064"        # between warm-gray and muted
HALO = "rgba(245,240,232,0.85)"  # --color-parchment
LAND = "#f1ebdf"
WATER = "#cdd3cc"
WATER_LINE = "#b9c2bb"
WOOD = "#e6e0cb"
ROAD = "#e2d6c1"
ROAD_MAJOR = "#d8c8ad"
BORDER = "#b4a387"

NAME = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]]
POLY = ["match", ["geometry-type"], ["MultiPolygon", "Polygon"], True, False]
LINE = ["match", ["geometry-type"], ["LineString", "MultiLineString"], True, False]
POINT = ["match", ["geometry-type"], ["MultiPoint", "Point"], True, False]
OMT = "openmaptiles"


def label(id_, filt, size, minzoom=None, maxzoom=None, upper=False, italic=False, color=LABEL, spacing=None):
    layer = {
        "id": id_, "type": "symbol", "source": OMT, "source-layer": "place", "filter": filt,
        "layout": {
            "text-field": NAME,
            "text-font": ["Noto Sans Italic" if italic else "Noto Sans Regular"],
            "text-size": size,
            "text-max-width": 8,
        },
        "paint": {"text-color": color, "text-halo-color": HALO, "text-halo-width": 1.2, "text-halo-blur": 0.5},
    }
    if upper:
        layer["layout"]["text-transform"] = "uppercase"
        layer["layout"]["text-letter-spacing"] = spacing or 0.12
    if minzoom is not None:
        layer["minzoom"] = minzoom
    if maxzoom is not None:
        layer["maxzoom"] = maxzoom
    return layer


style = {
    "version": 8,
    "name": "krumpos.org parchment",
    # Globe when zoomed out (the 1856 crossing reads as an arc over the
    # curve of the earth), flattening to Mercator by street zoom.
    "projection": {"type": "globe"},
    "sources": {
        "relief": {
            "type": "raster",
            "tiles": ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"],
            "tileSize": 256,
            "maxzoom": 6,
            "attribution": "Natural Earth",
        },
        OMT: {
            "type": "vector",
            "url": "https://tiles.openfreemap.org/planet",
            "attribution": '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
    },
    "glyphs": "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    "layers": [
        {"id": "background", "type": "background", "paint": {"background-color": LAND}},
        # Natural Earth shaded relief, bleached to a faint pencil texture and
        # faded out as the vector detail takes over.
        {
            "id": "relief", "type": "raster", "source": "relief", "maxzoom": 8,
            "paint": {
                "raster-saturation": -1,
                "raster-contrast": -0.35,
                "raster-brightness-min": 0.55,
                "raster-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 5, 0.32, 8, 0],
            },
        },
        {
            "id": "wood", "type": "fill", "source": OMT, "source-layer": "landcover", "minzoom": 7,
            "filter": ["all", POLY, ["==", ["get", "class"], "wood"]],
            "paint": {"fill-color": WOOD, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0, 10, 0.7]},
        },
        {
            "id": "park", "type": "fill", "source": OMT, "source-layer": "park", "minzoom": 8,
            "filter": POLY,
            "paint": {"fill-color": WOOD, "fill-opacity": 0.5},
        },
        {
            "id": "residential", "type": "fill", "source": OMT, "source-layer": "landuse", "minzoom": 9,
            "filter": ["all", POLY, ["==", ["get", "class"], "residential"]],
            "paint": {"fill-color": "#ebe2d2", "fill-opacity": 0.6},
        },
        {
            "id": "water", "type": "fill", "source": OMT, "source-layer": "water",
            "filter": ["all", POLY, ["!=", ["get", "brunnel"], "tunnel"]],
            "paint": {"fill-color": WATER},
        },
        {
            "id": "waterway", "type": "line", "source": OMT, "source-layer": "waterway", "minzoom": 6,
            "filter": LINE,
            "layout": {"line-cap": "round"},
            "paint": {"line-color": WATER_LINE, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 12, 1.4]},
        },
        {
            "id": "building", "type": "fill", "source": OMT, "source-layer": "building", "minzoom": 14,
            "paint": {"fill-color": "#e4d9c6", "fill-outline-color": "#d4c6ad"},
        },
        {
            "id": "road_minor", "type": "line", "source": OMT, "source-layer": "transportation", "minzoom": 12,
            "filter": ["all", LINE, ["match", ["get", "class"], ["minor", "service", "track"], True, False]],
            "layout": {"line-cap": "round", "line-join": "round"},
            "paint": {"line-color": ROAD, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 0.6, 18, 8]},
        },
        {
            "id": "road_major", "type": "line", "source": OMT, "source-layer": "transportation", "minzoom": 7,
            "filter": ["all", LINE, ["match", ["get", "class"], ["primary", "secondary", "tertiary", "trunk"], True, False]],
            "layout": {"line-cap": "round", "line-join": "round"},
            "paint": {"line-color": ROAD_MAJOR, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 7, 0.4, 12, 1.6, 18, 12]},
        },
        {
            "id": "road_motorway", "type": "line", "source": OMT, "source-layer": "transportation", "minzoom": 5,
            "filter": ["all", LINE, ["==", ["get", "class"], "motorway"]],
            "layout": {"line-cap": "round", "line-join": "round"},
            "paint": {"line-color": ROAD_MAJOR, "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 5, 0.4, 12, 2, 18, 14]},
        },
        {
            "id": "railway", "type": "line", "source": OMT, "source-layer": "transportation", "minzoom": 9,
            "filter": ["all", LINE, ["==", ["get", "class"], "rail"]],
            "paint": {"line-color": "#cbbca3", "line-width": 0.8, "line-dasharray": [4, 2]},
        },
        {
            "id": "boundary_state", "type": "line", "source": OMT, "source-layer": "boundary", "minzoom": 3,
            "filter": ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
            "layout": {"line-cap": "round", "line-join": "round"},
            "paint": {"line-color": BORDER, "line-opacity": 0.55, "line-dasharray": [3, 2],
                      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 10, 1.2]},
        },
        {
            "id": "boundary_country", "type": "line", "source": OMT, "source-layer": "boundary",
            "filter": ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!", ["has", "claimed_by"]]],
            "layout": {"line-cap": "round", "line-join": "round"},
            "paint": {"line-color": BORDER, "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 8, 1.6]},
        },
        {
            "id": "water_name", "type": "symbol", "source": OMT, "source-layer": "water_name",
            "filter": POINT,
            "layout": {"text-field": NAME, "text-font": ["Noto Sans Italic"], "text-size": 11,
                       "text-letter-spacing": 0.08, "text-max-width": 6},
            "paint": {"text-color": "#7f8a83", "text-halo-color": "rgba(205,211,204,0.7)", "text-halo-width": 1},
        },
        label("place_village", ["all", POINT, ["match", ["get", "class"], ["village", "hamlet"], True, False]], 10, minzoom=10),
        label("place_town", ["all", POINT, ["==", ["get", "class"], "town"]],
              ["interpolate", ["linear"], ["zoom"], 8, 10, 12, 12], minzoom=7),
        label("place_city", ["all", POINT, ["==", ["get", "class"], "city"], [">", ["get", "rank"], 3]],
              ["interpolate", ["linear"], ["zoom"], 5, 10, 10, 13], minzoom=5),
        label("place_city_large", ["all", POINT, ["==", ["get", "class"], "city"], ["<=", ["get", "rank"], 3]],
              ["interpolate", ["linear"], ["zoom"], 3, 10, 8, 14], minzoom=3, color=INK),
        label("place_state", ["all", POINT, ["==", ["get", "class"], "state"]], 10, minzoom=4, maxzoom=8, upper=True),
        label("place_country", ["all", POINT, ["==", ["get", "class"], "country"]],
              ["interpolate", ["linear"], ["zoom"], 1, 10, 5, 13], maxzoom=7, upper=True, spacing=0.18),
    ],
}

out = Path(__file__).resolve().parent.parent / "public" / "map" / "parchment.json"
out.write_text(json.dumps(style, indent=1) + "\n")
print(f"wrote {out} ({len(style['layers'])} layers)")
