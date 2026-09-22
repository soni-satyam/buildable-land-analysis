from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from shapely.geometry import shape, mapping, LineString, Point
import geopandas as gpd
from pyproj import CRS, Transformer
from shapely.ops import transform, unary_union, polygonize, nearest_points

from app.config import load_setback_config
from app.data_loader import (
    load_parcel,
    load_parcels_in_bbox,
    load_constraint_layers_near,
    DataNotAvailableError,
)
from app.geometry import compute_buildable_area
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    BreakdownItem,
    GeoJSONGeometry,
    LinesToAreaRequest,
    LinesToAreaResponse,
    ParcelFeature,
    ParcelsInBboxResponse,
    SegmentFeature,
)

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
    except DataNotAvailableError as e:
        raise HTTPException(503, str(e))
    geom = gdf.geometry.iloc[0]
    if geom is None or geom.is_empty:
        raise HTTPException(422, "Parcel geometry is empty")
    if not geom.is_valid:
        geom = geom.make_valid()
    return {"parcel_id": parcel_id, "geometry": mapping(geom)}


PARCEL_VIEWPORT_LIMIT = 1500


@app.get("/api/parcels", response_model=ParcelsInBboxResponse)
def get_parcels_in_viewport(
    bbox: str = Query(
        ...,
        description="minLon,minLat,maxLon,maxLat (EPSG:4326), e.g. the current map viewport",
    )
):
    try:
        parts = [float(v) for v in bbox.split(",")]
        if len(parts) != 4:
            raise ValueError
        minx, miny, maxx, maxy = parts
    except ValueError:
        raise HTTPException(400, "bbox must be 'minLon,minLat,maxLon,maxLat'")

    if minx >= maxx or miny >= maxy:
        raise HTTPException(400, "bbox min values must be less than max values")

    # Guard against a very zoomed-out viewport triggering an expensive scan
    # over a huge chunk of the 1.5M-parcel dataset.
    if (maxx - minx) * (maxy - miny) > 0.25:  # roughly a ~55km-per-side box
        raise HTTPException(
            400,
            "Viewport is too large to load parcels for - zoom in further before parcel outlines will appear.",
        )

    try:
        gdf, id_field, truncated = load_parcels_in_bbox(
            (minx, miny, maxx, maxy), CONFIG, limit=PARCEL_VIEWPORT_LIMIT
        )
    except DataNotAvailableError as e:
        raise HTTPException(503, str(e))

    features = [
        ParcelFeature(parcel_id=str(getattr(row, id_field)), geometry=GeoJSONGeometry(**mapping(row.geometry)))
        for row in gdf.itertuples(index=False)
    ]

    note = (
        f"Showing {len(features)} of the parcels in view; zoom in for a complete set."
        if truncated
        else f"{len(features)} parcels in view."
    )

    return ParcelsInBboxResponse(parcels=features, count=len(features), truncated=truncated, note=note)

MAX_SKETCH_LINES = 200

@app.post("/api/lines-to-area", response_model=LinesToAreaResponse)
def lines_to_area(req: LinesToAreaRequest):
    """
    Turn hand-drawn lines into the land they enclose.

    Works in the analytical CRS (feet). Lines may cross each other or stop a
    little short of meeting; ends within `snap_ft` of another line (or of
    their own opposite end) are bridged. Returns geometry=null when the
    lines don't close off any area.
    """
    if not req.lines or len(req.lines) > MAX_SKETCH_LINES:
        raise HTTPException(400, f"Provide between 1 and {MAX_SKETCH_LINES} lines")

    lines = []
    for g in req.lines:
        geom = _geojson_to_area_crs(g, AREA_CRS)
        parts = list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]
        lines.extend(p for p in parts if p.geom_type == "LineString" and p.length > 0)

    if not lines:
        return LinesToAreaResponse()

    # Bridge small gaps at line ends.
    tol = max(float(req.snap_ft), 0.0)
    bridges = []
    if tol > 0:
        for i, line in enumerate(lines):
            if line.length <= tol:
                continue
            start, end = Point(line.coords[0]), Point(line.coords[-1])
            others = [l for j, l in enumerate(lines) if j != i]
            for p, opposite in ((start, end), (end, start)):
                target = unary_union(others + [opposite])
                q = nearest_points(p, target)[1]
                d = p.distance(q)
                if 0 < d <= tol:
                    bridges.append(LineString([p, q]))

    # unary_union nodes the lines (splits them where they cross);
    # polygonize then returns every closed face they form.
    noded = unary_union(lines + bridges)
    segments = list(noded.geoms) if hasattr(noded, "geoms") else [noded]
    faces = [f for f in polygonize(segments) if f.area > 1.0]  # > 1 sq ft, ignores slivers
    if not faces:
        return LinesToAreaResponse()

    area = unary_union(faces)
    area_wgs84 = gpd.GeoSeries([area], crs=AREA_CRS).to_crs("EPSG:4326").iloc[0]
    return LinesToAreaResponse(geometry=GeoJSONGeometry(**mapping(area_wgs84)))


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    if not req.parcel_id and not req.custom_geometry:
        raise HTTPException(400, "Provide either parcel_id or custom_geometry")

    selection_label = None
    if req.parcel_id:
        try:
            parcel_gdf = load_parcel(req.parcel_id, CONFIG)
        except ValueError as e:
            raise HTTPException(404, str(e))
        except DataNotAvailableError as e:
            raise HTTPException(503, str(e))
        selection_label = req.parcel_id
    else:
        # Freehand area drawn by the user on the map - no Prop_ID exists
        # for it, so it's built directly from the submitted GeoJSON
        # (EPSG:4326, as MapLibre/GeoJSON always is) rather than looked up.
        drawn_geom = shape(req.custom_geometry.dict())
        if drawn_geom.is_empty:
            raise HTTPException(422, "Drawn area geometry is empty")
        if not drawn_geom.is_valid:
            drawn_geom = drawn_geom.make_valid()
        parcel_gdf = gpd.GeoDataFrame(geometry=[drawn_geom], crs="EPSG:4326")

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
        cid: {
            "buffer_ft": c.get("buffer_ft", 0),
            "enabled": c.get("enabled", True),
            "reason": c.get("reason"),
            "filter": c.get("filter"),
        }
        for cid, c in CONFIG.get("constraints", {}).items()
    }

    for cid, s in req.constraint_settings.items():
        if cid not in setback_cfg:
            continue                      # ignore unknown ids
        if s.buffer_ft is not None:
            setback_cfg[cid]["buffer_ft"] = s.buffer_ft
        if s.enabled is not None:
            setback_cfg[cid]["enabled"] = s.enabled

    max_buffer_ft = max(
        (float(c.get("buffer_ft", 0) or 0) for c in setback_cfg.values() if c.get("enabled", True)),
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
        restored_acres,
        segments,
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

    # Per-constraint overlays (wetlands / fema_flood / buildings /
    # transmission), reprojected back to WGS84, so the frontend can render
    # and toggle each independently rather than only the combined
    # "excluded" shape. Manual exclusions have no `.geometry` set and are
    # skipped here - they're already part of `excluded`.
    CONSTRAINT_LAYER_KEYS = set(setback_cfg)
    layers_wgs84: dict = {}
    for b in breakdown:
        if b.layer in CONSTRAINT_LAYER_KEYS and b.geometry is not None and not b.geometry.is_empty:
            g = gpd.GeoSeries([b.geometry], crs=AREA_CRS).to_crs("EPSG:4326").iloc[0]
            layers_wgs84[b.layer] = mapping(g)
    
    segments_wgs84: dict = {}
    crs_units_are_feet = "2278" in AREA_CRS or "ftUS" in AREA_CRS
    sqft_per_acre = 43560.0
    sqm_per_acre = 4046.8564224
    for layer_key, geoms in segments.items():
        if not geoms:
            continue
        acres_list = [
            g.area / (sqft_per_acre if crs_units_are_feet else sqm_per_acre)
            for g in geoms
        ]
        segments_gs = gpd.GeoSeries(geoms, crs=AREA_CRS).to_crs("EPSG:4326")
        segments_wgs84[layer_key] = [
            SegmentFeature(
                id=f"{layer_key}-{i}",
                acres=round(acres_list[i], 4),
                geometry=GeoJSONGeometry(**mapping(g)),
            )
            for i, g in enumerate(segments_gs)
        ]

    return AnalyzeResponse(
        parcel_id=selection_label,
        parcel_acres=round(parcel_acres, 2),
        excluded_acres=round(excluded_acres, 2),
        buildable_acres_raw=round(buildable_acres_raw, 4),
        buildable_acres=round(buildable_acres_raw, 2),
        restored_acres=round(restored_acres, 4),
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
        layers=layers_wgs84,
        segments=segments_wgs84
    )