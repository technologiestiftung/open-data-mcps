// ABOUTME: Transform GeoJSON coordinates from projected CRS to WGS84 (EPSG:4326)
// ABOUTME: Handles all geometry types and preserves GeoJSON structure for web map compatibility

import proj4 from 'proj4';
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';

export class GeoJSONTransformer {
  /**
   * Transform GeoJSON from source CRS to WGS84 (EPSG:4326) for web maps
   * Detects source CRS from GeoJSON crs property or uses provided sourceCRS
   */
  transformToWGS84(geojson: any, sourceCRS?: string): FeatureCollection {
    // Detect source CRS from GeoJSON
    const detectedCRS = this.detectCRS(geojson);
    const fromCRS = sourceCRS || detectedCRS;

    if (!fromCRS) {
      // No CRS specified - assume it's already WGS84
      console.warn('[GeoJSONTransformer] No CRS detected, assuming WGS84');
      return this.cleanGeoJSON(geojson);
    }

    if (fromCRS === 'EPSG:4326' || fromCRS === 'urn:ogc:def:crs:OGC:1.3:CRS84') {
      // Already WGS84 - just clean up CRS property
      console.error('[GeoJSONTransformer] Already in WGS84, no transformation needed');
      return this.cleanGeoJSON(geojson);
    }

    console.error(`[GeoJSONTransformer] Transforming from ${fromCRS} to EPSG:4326`);

    // Create transformation
    const transform = this.createTransform(fromCRS, 'EPSG:4326');

    // Transform all features and their geometries
    const transformed: any = {
      type: 'FeatureCollection',
      features: geojson.features.map((feature: Feature) => {
        const transformedFeature: any = {
          ...feature,
          geometry: this.transformGeometry(feature.geometry, transform),
        };

        // Recursively transform all bbox fields in this feature
        this.transformBboxRecursive(transformedFeature, transform);

        return transformedFeature;
      }),
    };

    // Recursively transform all bbox fields at FeatureCollection level
    this.transformBboxRecursive(transformed, transform);

    return transformed;
  }

  /**
   * Detect CRS from GeoJSON crs property
   */
  private detectCRS(geojson: any): string | null {
    if (!geojson.crs) {
      return null;
    }

    // Handle CRS object with name property
    if (geojson.crs.type === 'name' && geojson.crs.properties?.name) {
      const crsName = geojson.crs.properties.name;

      // Parse URN format: urn:ogc:def:crs:EPSG::25833
      const urnMatch = crsName.match(/urn:ogc:def:crs:EPSG::(\d+)/);
      if (urnMatch) {
        return `EPSG:${urnMatch[1]}`;
      }

      // Parse direct EPSG format
      const epsgMatch = crsName.match(/EPSG:(\d+)/);
      if (epsgMatch) {
        return crsName;
      }

      // Handle OGC CRS84 (equivalent to EPSG:4326)
      if (crsName.includes('CRS84')) {
        return 'urn:ogc:def:crs:OGC:1.3:CRS84';
      }
    }

    return null;
  }

  /**
   * Create proj4 transformation function
   */
  private createTransform(fromCRS: string, toCRS: string): (coord: Position) => Position {
    // Define common projections
    // EPSG:25833 - ETRS89 / UTM zone 33N (Berlin standard)
    proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

    // EPSG:4326 is built-in (WGS84)

    return (coord: Position): Position => {
      // proj4 expects [x, y] (or [lon, lat])
      const [x, y] = coord;
      const transformed = proj4(fromCRS, toCRS, [x, y]);

      // Round to 7 decimal places (~1cm precision) to reduce file size
      // This preserves all meaningful precision from UTM source data
      return [
        Math.round(transformed[0] * 10000000) / 10000000,
        Math.round(transformed[1] * 10000000) / 10000000
      ];
    };
  }

  /**
   * Transform geometry coordinates recursively
   */
  private transformGeometry(geometry: Geometry | null, transform: (coord: Position) => Position): Geometry | null {
    if (!geometry) return null;

    switch (geometry.type) {
      case 'Point':
        return {
          type: 'Point',
          coordinates: transform(geometry.coordinates as Position),
        };

      case 'LineString':
        return {
          type: 'LineString',
          coordinates: (geometry.coordinates as Position[]).map(transform),
        };

      case 'Polygon':
        return {
          type: 'Polygon',
          coordinates: (geometry.coordinates as Position[][]).map(ring =>
            ring.map(transform)
          ),
        };

      case 'MultiPoint':
        return {
          type: 'MultiPoint',
          coordinates: (geometry.coordinates as Position[]).map(transform),
        };

      case 'MultiLineString':
        return {
          type: 'MultiLineString',
          coordinates: (geometry.coordinates as Position[][]).map(line =>
            line.map(transform)
          ),
        };

      case 'MultiPolygon':
        return {
          type: 'MultiPolygon',
          coordinates: (geometry.coordinates as Position[][][]).map(polygon =>
            polygon.map(ring => ring.map(transform))
          ),
        };

      case 'GeometryCollection':
        return {
          type: 'GeometryCollection',
          geometries: geometry.geometries.map(geom =>
            this.transformGeometry(geom, transform)
          ).filter((g): g is Geometry => g !== null),
        };

      default:
        console.warn(`[GeoJSONTransformer] Unknown geometry type: ${(geometry as any).type}`);
        return geometry;
    }
  }

  /**
   * Recursively find and transform all bbox fields in an object
   */
  private transformBboxRecursive(obj: any, transform: (coord: Position) => Position): void {
    if (!obj || typeof obj !== 'object') return;

    // If this object has a bbox field, transform it
    if (obj.bbox && Array.isArray(obj.bbox)) {
      obj.bbox = this.transformBbox(obj.bbox, transform);
    }

    // Recursively process all properties (except geometry which is handled separately)
    for (const key in obj) {
      if (key !== 'geometry' && typeof obj[key] === 'object' && obj[key] !== null) {
        this.transformBboxRecursive(obj[key], transform);
      }
    }
  }

  /**
   * Transform bbox (bounding box) coordinates
   * bbox format: [minX, minY, maxX, maxY] for 2D
   *              [minX, minY, minZ, maxX, maxY, maxZ] for 3D
   */
  private transformBbox(bbox: number[], transform: (coord: Position) => Position): number[] {
    if (bbox.length === 4) {
      // 2D bbox: [minX, minY, maxX, maxY]
      const [minX, minY] = transform([bbox[0], bbox[1]]);
      const [maxX, maxY] = transform([bbox[2], bbox[3]]);
      return [minX, minY, maxX, maxY];
    } else if (bbox.length === 6) {
      // 3D bbox: [minX, minY, minZ, maxX, maxY, maxZ]
      const [minX, minY] = transform([bbox[0], bbox[1]]);
      const [maxX, maxY] = transform([bbox[3], bbox[4]]);
      // Z coordinates remain unchanged in 2D projection transformation
      return [minX, minY, bbox[2], maxX, maxY, bbox[5]];
    }
    return bbox; // Unknown format, return unchanged
  }

  /**
   * Remove CRS property from GeoJSON (not needed for WGS84 per spec)
   */
  private cleanGeoJSON(geojson: any): FeatureCollection {
    const cleaned = { ...geojson };
    delete cleaned.crs;
    return cleaned;
  }
}
