"""
Loads parcel and constraint layer data.

Performance:
- Parcels are queried by Prop_ID.
- Constraint layers are spatially filtered using a bbox.
- The bbox is transformed into each layer's native CRS before querying.
"""

from pathlib import Path

import geopandas as gpd
from pyproj import Transformer
from shapely.geometry import box


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _resolve(path_str: str) -> Path:
    p = Path(path_str)

    if p.is_absolute():
        return p

    return PROJECT_ROOT / p


def load_parcel(
    parcel_id: str,
    config: dict,
) -> gpd.GeoDataFrame:

    cfg = config["paths"]["parcels"]

    path = _resolve(cfg["file"])
    id_field = cfg["id_field"]

    # Prop_ID is expected to be numeric/string depending on the source.
    # Escape single quotes to avoid breaking the WHERE clause.
    safe_id = str(parcel_id).replace("'", "''")

    where = f"{id_field} = '{safe_id}'"

    gdf = gpd.read_file(
        path,
        layer=cfg.get("layer"),
        where=where,
        engine="pyogrio",
    )

    if gdf.empty:
        raise ValueError(
            f"Parcel {parcel_id} not found "
            f"(field: {id_field})"
        )

    if gdf.crs is None:
        gdf = gdf.set_crs(
            cfg["source_crs"]
        )

    gdf = gdf.copy()

    gdf["geometry"] = gdf.geometry.make_valid()

    return gdf


def _transform_bbox(
    bbox_wgs84: tuple,
    target_crs: str,
) -> tuple:

    minx, miny, maxx, maxy = bbox_wgs84

    if target_crs.upper() in (
        "EPSG:4326",
        "EPSG:4269",
    ):
        # These are both longitude/latitude systems.
        # For small county-scale bbox filtering, using the
        # WGS84 bbox directly is fine.
        return (
            minx,
            miny,
            maxx,
            maxy,
        )

    transformer = Transformer.from_crs(
        "EPSG:4326",
        target_crs,
        always_xy=True,
    )

    corners = [
        transformer.transform(minx, miny),
        transformer.transform(minx, maxy),
        transformer.transform(maxx, miny),
        transformer.transform(maxx, maxy),
    ]

    xs = [p[0] for p in corners]
    ys = [p[1] for p in corners]

    return (
        min(xs),
        min(ys),
        max(xs),
        max(ys),
    )


def _load_layer_near(
    layer_key: str,
    config: dict,
    bbox_wgs84: tuple,
) -> gpd.GeoDataFrame:

    cfg = config["paths"].get(layer_key)

    if not cfg:
        return gpd.GeoDataFrame(
            geometry=[],
            crs="EPSG:4326",
        )

    path = _resolve(cfg["file"])

    if not path.exists():
        return gpd.GeoDataFrame(
            geometry=[],
            crs=cfg.get("source_crs"),
        )

    source_crs = cfg.get(
        "source_crs"
    )

    query_bbox = _transform_bbox(
        bbox_wgs84,
        source_crs,
    )

    gdf = gpd.read_file(
        path,
        layer=cfg.get("layer"),
        bbox=query_bbox,
        engine="pyogrio",
    )

    if gdf.crs is None:
        gdf = gdf.set_crs(
            source_crs
        )

    if not gdf.empty:
        gdf = gdf.copy()
        gdf["geometry"] = (
            gdf.geometry.make_valid()
        )

    return gdf


def load_constraint_layers_near(
    parcel_bounds_wgs84: tuple,
    buffer_ft: float,
    config: dict,
) -> dict[str, gpd.GeoDataFrame]:

    """
    Load only constraint features near the parcel.

    `buffer_ft` is expressed in feet because the analysis CRS
    and configured setbacks use feet.

    We convert that distance to an approximate WGS84 search
    expansion for the initial bbox, then transform that bbox
    into each layer's native CRS.
    """

    minx, miny, maxx, maxy = parcel_bounds_wgs84

    # Approximate feet -> degrees for the query window.
    #
    # This is ONLY for fetching nearby features.
    # It is NOT used for area calculations or actual buffers.
    feet_per_degree_lat = 364000.0

    lat_margin = buffer_ft / feet_per_degree_lat

    # Longitude degrees get smaller toward the poles.
    # Harris County is around 30N, so ~315,000 ft/degree
    # is a reasonable conservative approximation.
    feet_per_degree_lon = 315000.0

    lon_margin = buffer_ft / feet_per_degree_lon

    expanded_bbox = (
        minx - lon_margin,
        miny - lat_margin,
        maxx + lon_margin,
        maxy + lat_margin,
    )

    layers = {}

    for key in (
        "wetlands",
        "fema",
        "buildings",
        "transmission",
    ):

        gdf = _load_layer_near(
            key,
            config,
            expanded_bbox,
        )

        if not gdf.empty:
            layers[key] = gdf

    return layers