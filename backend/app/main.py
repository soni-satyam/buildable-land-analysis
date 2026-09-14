from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from shapely.geometry import shape, mapping
import geopandas as gpd
from pyproj import CRS, Transformer
from shapely.ops import transform

from app.config import load_setback_config
from app.data_loader import load_parcel, load_constraint_layers_near
from app.geometry import compute_buildable_area
from app.models import AnalyzeRequest, AnalyzeResponse, BreakdownItem, GeoJSONGeometry

app = FastAPI(title="Buildable Land Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CONFIG = load_setback_config()
AREA_CRS = CONFIG.get("area_crs", "EPSG:2278")

NOTE = (
    "This is an estimated buildable area for screening purposes only, not a "
    "legal determination of development rights. Constraint buffers are "
    "configurable assumptions unless a specific regulation is cited. "
    "Category breakdown values may overlap; excluded_acres reflects the "
    "union of all exclusions, not their sum."
)


@app.get("/health")
def health():
    return {"status": "ok"}

def _geojson_to_area_crs(geojson_geometry, area_crs: str):
    """
    Convert a frontend GeoJSON geometry from EPSG:4326 into
    the analytical CRS.
    """
    geom = shape(geojson_geometry.dict())

    if geom.is_empty:
        return geom

    if not geom.is_valid:
        geom = geom.make_valid()

    transformer = Transformer.from_crs(
        "EPSG:4326",
        area_crs,
        always_xy=True,
    )

    projected = transform(
        transformer.transform,
        geom,
    )

    if not projected.is_valid:
        projected = projected.make_valid()

    return projected

@app.get("/api/parcels/{parcel_id}")
def get_parcel(parcel_id: str):
    try:
        gdf = load_parcel(parcel_id, CONFIG)
    except ValueError as e:
        raise HTTPException(404, str(e))
    geom = gdf.geometry.iloc[0]
    if geom is None or geom.is_empty:
        raise HTTPException(422, "Parcel geometry is empty")
    if not geom.is_valid:
        geom = geom.make_valid()
    return {"parcel_id": parcel_id, "geometry": mapping(geom)}


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    try:
        parcel_gdf = load_parcel(req.parcel_id, CONFIG)
    except ValueError as e:
        raise HTTPException(404, str(e))

    geom = parcel_gdf.geometry.iloc[0]
    if geom is None or geom.is_empty:
        raise HTTPException(422, "Parcel geometry is empty")
    if not geom.is_valid:
        parcel_gdf = parcel_gdf.copy()
        parcel_gdf["geometry"] = parcel_gdf.geometry.make_valid()

    # Expand the parcel's bbox to cover the largest configured buffer so
    # nearby constraint features aren't missed. ~0.01 deg is roughly 1km;
    # generous enough to cover a few hundred feet of buffer with margin.
    setback_cfg = {
        k: dict(v)
        for k, v in CONFIG.get("setbacks", {}).items()
    }
    
    if req.wetland_buffer_ft is not None:
        setback_cfg.setdefault("wetlands", {})["buffer_ft"] = req.wetland_buffer_ft
    if req.building_setback_ft is not None:
        setback_cfg.setdefault("buildings", {})["buffer_ft"] = req.building_setback_ft
    if req.transmission_buffer_ft is not None:
        setback_cfg.setdefault("transmission", {})["buffer_ft"] = req.transmission_buffer_ft
    if req.exclude_sfha is not None:
        setback_cfg.setdefault("fema", {})["exclude_sfha"] = req.exclude_sfha

      # ---------------------------------------------------------
    # Determine largest requested buffer
    #
    # This controls how far beyond the parcel we query for
    # nearby constraint features.
    #
    # IMPORTANT:
    # This is only for finding nearby features.
    # Actual buffering is performed in EPSG:2278 inside
    # compute_buildable_area().
    # ---------------------------------------------------------
    buffer_values = [
        float(
            setback_cfg
            .get("wetlands", {})
            .get("buffer_ft", 0)
            or 0
        ),
        float(
            setback_cfg
            .get("buildings", {})
            .get("buffer_ft", 0)
            or 0
        ),
        float(
            setback_cfg
            .get("transmission", {})
            .get("buffer_ft", 0)
            or 0
        ),
    ]

    max_buffer_ft = max(
        buffer_values,
        default=0.0,
    )

    # ---------------------------------------------------------
    # Get parcel bbox in WGS84
    #
    # load_constraint_layers_near() accepts a WGS84 bbox and
    # transforms that bbox into each source layer's native CRS.
    # ---------------------------------------------------------
    parcel_wgs84_gdf = parcel_gdf.to_crs(
        "EPSG:4326"
    )

    minx, miny, maxx, maxy = (
        parcel_wgs84_gdf.total_bounds
    )

    # ---------------------------------------------------------
    # Load only nearby constraint features
    # ---------------------------------------------------------
    constraint_layers = load_constraint_layers_near(
        (minx, miny, maxx, maxy),
        buffer_ft=max_buffer_ft,
        config=CONFIG,
    )
    
        # ---------------------------------------------------------
    # Convert frontend-drawn GeoJSON into analytical CRS
    #
    # MapLibre/GeoJSON coordinates are WGS84 longitude/latitude.
    #
    # geometry.py expects manual geometries to already be in
    # AREA_CRS (EPSG:2278).
    # ---------------------------------------------------------
    
    def _to_shapes(adjustments):
        out = []

        for adjustment in adjustments:

            # Frontend GeoJSON is WGS84 longitude/latitude.
            g = _geojson_to_area_crs(
                adjustment.geometry,
                AREA_CRS,
            )

            if g is not None and not g.is_empty:
                out.append(g)

        return out

    manual_excludes = _to_shapes(req.user_exclusions)
    manual_restores = _to_shapes(req.user_restores)

    (
        parcel_acres,
        buildable_acres_raw,
        breakdown,
        excluded_acres,
        buildable_geom,
        excluded_geom,
    ) = compute_buildable_area(
        parcel_gdf,
        constraint_layers,
        setback_cfg,
        AREA_CRS,
        manual_excludes=manual_excludes,
        manual_restores=manual_restores,
    )

    parcel_wgs84 = gpd.GeoSeries([parcel_gdf.to_crs(AREA_CRS).geometry.union_all()], crs=AREA_CRS).to_crs("EPSG:4326").iloc[0]
    buildable_wgs84 = gpd.GeoSeries([buildable_geom], crs=AREA_CRS).to_crs("EPSG:4326").iloc[0]
    excluded_wgs84 = (
        gpd.GeoSeries([excluded_geom], crs=AREA_CRS).to_crs("EPSG:4326").iloc[0]
        if excluded_geom is not None and not excluded_geom.is_empty
        else buildable_wgs84.difference(buildable_wgs84)  # empty geometry, same type
    )

    return AnalyzeResponse(
        parcel_id=req.parcel_id,
        parcel_acres=round(parcel_acres, 2),
        excluded_acres=round(excluded_acres, 2),
        buildable_acres_raw=round(buildable_acres_raw, 4),
        buildable_acres=round(buildable_acres_raw, 2),
        breakdown=[
            BreakdownItem(layer=b.layer, acres_removed=b.acres_removed, buffer_ft=b.buffer_ft, reason=b.reason)
            for b in breakdown
        ],
        note=NOTE,
        geometry={
            "parcel": mapping(parcel_wgs84),
            "buildable": mapping(buildable_wgs84),
            "excluded": mapping(excluded_wgs84),
        },
    )
