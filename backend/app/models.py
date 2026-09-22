from pydantic import BaseModel, Field
from typing import Literal, Optional


class GeoJSONGeometry(BaseModel):
    type: str
    coordinates: list


class ConstraintOverride(BaseModel):
    """Optional per-request override of a configured buffer distance."""
    layer: str
    buffer_ft: float


class ManualAdjustment(BaseModel):
    """A user-drawn carve-out (exclude) or add-back (restore) shape."""
    kind: Literal["exclude", "restore"]
    geometry: GeoJSONGeometry


class BuildableAreaRequest(BaseModel):
    parcel_id: Optional[str] = None
    parcel_geometry: Optional[GeoJSONGeometry] = None
    overrides: list[ConstraintOverride] = []
    manual_adjustments: list[ManualAdjustment] = []


class RemovalBreakdownItem(BaseModel):
    layer: str
    acres_removed: float
    buffer_ft: float
    reason: str


class BuildableAreaResponse(BaseModel):
    parcel_acres: float
    buildable_acres: float
    breakdown: list[RemovalBreakdownItem]
    buildable_geometry: GeoJSONGeometry
    excluded_geometry: GeoJSONGeometry

class ConstraintSetting(BaseModel):
    buffer_ft: Optional[float] = Field(default=None, ge=0)   # also rejects negative buffers
    enabled: Optional[bool] = None


class AnalyzeRequest(BaseModel):
    # Either an existing parcel's Prop_ID, OR a freehand-drawn polygon
    # (custom_geometry, in EPSG:4326) can be analyzed. Exactly one should
    # be provided; main.py enforces that.
    parcel_id: Optional[str] = None
    custom_geometry: Optional[GeoJSONGeometry] = None

    constraint_settings: dict[str, ConstraintSetting] = Field(default_factory=dict)

    user_exclusions: list[ManualAdjustment] = Field(
        default_factory=list
    )

    user_restores: list[ManualAdjustment] = Field(
        default_factory=list
    )
    
class BreakdownItem(BaseModel):
    layer: str
    acres_removed: float
    buffer_ft: float
    reason: str

class SegmentFeature(BaseModel):
    id: str
    acres: float
    geometry: GeoJSONGeometry

class AnalyzeResponse(BaseModel):
    # None when the analyzed area was a freehand drawn polygon rather than
    # a real parcel (no Prop_ID exists for it).
    parcel_id: Optional[str] = None

    parcel_acres: float
    excluded_acres: float
    buildable_acres_raw: float
    buildable_acres: float
    # Total acreage clawed back by the user's manual "restore" draws /
    # right-click overrides. Surfaced separately (not silently folded into
    # "buildable") so the UI can flag it for the user to double check.
    restored_acres: float = 0.0

    breakdown: list[BreakdownItem]
    note: str

    geometry: dict
    layers: dict = Field(default_factory=dict)
    segments: dict[str, list[SegmentFeature]] = Field(default_factory=dict)


class ParcelFeature(BaseModel):
    parcel_id: str
    geometry: GeoJSONGeometry


class ParcelsInBboxResponse(BaseModel):
    parcels: list[ParcelFeature]
    count: int
    truncated: bool
    note: str
    

class LinesToAreaRequest(BaseModel):
    lines: list[GeoJSONGeometry]      # LineStrings, EPSG:4326
    snap_ft: float = 15.0             # gaps up to this size between line ends count as connected
 
 
class LinesToAreaResponse(BaseModel):
    # None when the lines don't enclose any land.
    geometry: Optional[GeoJSONGeometry] = None
 